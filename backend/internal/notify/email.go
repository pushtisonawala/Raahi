package notify

import (
	"fmt"
	"net/smtp"
	"os"
	"strings"
)

func SendEmail(to string, subject string, plainBody string, htmlBody string) error {
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

	auth := smtp.PlainAuth("", from, password, smtpHost)

	return smtp.SendMail(
		smtpHost+":"+smtpPort,
		auth,
		from,
		[]string{to},
		[]byte(message),
	)
}