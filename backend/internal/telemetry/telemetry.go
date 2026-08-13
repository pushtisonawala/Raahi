package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func Init(ctx context.Context, serviceName string) (shutdown func(context.Context) error, err error) {
	res, err := resource.Merge(
		resource.Default(),
		resource.NewSchemaless(attribute.String("service.name", serviceName)),
	)
	if err != nil {
		return nil, fmt.Errorf("telemetry: build resource: %w", err)
	}

	var exporter sdktrace.SpanExporter
	if endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); endpoint != "" {
		exporter, err = otlptracehttp.New(ctx)
		if err != nil {
			return nil, fmt.Errorf("telemetry: build otlp exporter: %w", err)
		}
		log.Printf("telemetry: exporting traces via OTLP to %s", endpoint)
	} else {
		exporter, err = stdouttrace.New(stdouttrace.WithPrettyPrint())
		if err != nil {
			return nil, fmt.Errorf("telemetry: build stdout exporter: %w", err)
		}
		log.Println("telemetry: OTEL_EXPORTER_OTLP_ENDPOINT not set, printing spans to stdout instead")
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	return func(shutdownCtx context.Context) error {
		shutdownCtx, cancel := context.WithTimeout(shutdownCtx, 5*time.Second)
		defer cancel()
		if err := tp.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("telemetry: shutdown: %w", err)
		}
		return nil
	}, nil
}

var tracer = otel.Tracer("raahi/backend")

func Tracer() trace.Tracer { return tracer }

type Carrier map[string]string

func (c Carrier) Get(key string) string { return c[key] }
func (c Carrier) Set(key, value string) { c[key] = value }
func (c Carrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	return keys
}

func Inject(ctx context.Context) Carrier {
	c := Carrier{}
	otel.GetTextMapPropagator().Inject(ctx, c)
	return c
}

func Extract(ctx context.Context, c Carrier) context.Context {
	if len(c) == 0 {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, c)
}

func InjectJSON(ctx context.Context) ([]byte, error) {
	return json.Marshal(Inject(ctx))
}

func ExtractJSON(ctx context.Context, raw []byte) context.Context {
	if len(raw) == 0 {
		return ctx
	}
	var c Carrier
	if err := json.Unmarshal(raw, &c); err != nil {
		log.Printf("telemetry: failed to parse trace context, continuing without a parent span: %v", err)
		return ctx
	}
	return Extract(ctx, c)
}
