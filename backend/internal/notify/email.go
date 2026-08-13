package notify

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"os"
	"strings"
	"time"

	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/breaker"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/telemetry"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const smtpTimeout = 10 * time.Second

// smtpBreaker guards every SendEmail call. 5 consecutive failures trips it
// open for a minute, so once SMTP is confirmed to be having a bad stretch,
// every subsequent send fails instantly instead of separately waiting out
// its own smtpTimeout. It protects all three email types (overdue,
// contact-alert, SOS) at once, since they all funnel through this one
// function.
var smtpBreaker = breaker.New(5, 1*time.Minute)

func SendEmail(ctx context.Context, to string, subject string, plainBody string, htmlBody string) error {
	ctx, span := telemetry.Tracer().Start(ctx, "smtp.send", trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()
	span.SetAttributes(attribute.String("smtp.to", to))

	err := smtpBreaker.Call(func() error {
		return sendEmailNow(ctx, to, subject, plainBody, htmlBody)
	})

	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		if err == breaker.ErrOpen {
			span.SetAttributes(attribute.Bool("breaker.open", true))
		}
	}
	return err
}

// sendEmailNow is the actual SMTP conversation, reimplemented from what
// smtp.SendMail does internally, with one addition: a hard deadline on the
// connection. Plain smtp.SendMail never sets one, so a server that accepts
// the TCP connection and then goes silent mid-conversation can hang the
// caller indefinitely - exactly the failure mode that turned "email a
// contact" into "the SOS button doesn't respond."
func sendEmailNow(ctx context.Context, to string, subject string, plainBody string, htmlBody string) error {
	from := os.Getenv("SMTP_EMAIL")
	password := os.Getenv("SMTP_PASSWORD")

	smtpHost := "smtp.gmail.com"
	smtpPort := "587"
	boundary := "raahi-multipart-boundary"

	message := strings.Join([]string{
		fmt.Sprintf("From: %s", from),
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		fmt.Sprintf("Content-Type: multipart/alternative; boundary=%q", boundary),
		"",
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 7bit",
		"",
		plainBody,
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/html; charset=UTF-8",
		"Content-Transfer-Encoding: 7bit",
		"",
		htmlBody,
		fmt.Sprintf("--%s--", boundary),
		"",
	}, "\r\n")

	conn, err := net.DialTimeout("tcp", smtpHost+":"+smtpPort, smtpTimeout)
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	// Bounds every subsequent read/write on this connection, not just the
	// initial handshake - this is the actual fix, not the dial timeout
	// above (a server that accepts the connection and then stalls mid-
	// conversation is the case that matters).
	if err := conn.SetDeadline(time.Now().Add(smtpTimeout)); err != nil {
		conn.Close()
		return fmt.Errorf("smtp set deadline: %w", err)
	}

	client, err := smtp.NewClient(conn, smtpHost)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Close()

	if err := client.Hello("localhost"); err != nil {
		return fmt.Errorf("smtp hello: %w", err)
	}

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: smtpHost}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}

	if ok, _ := client.Extension("AUTH"); ok {
		auth := smtp.PlainAuth("", from, password, smtpHost)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write([]byte(message)); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close data: %w", err)
	}

	return client.Quit()
}
