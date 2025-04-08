import { createWriteStream } from 'fs';

import { diag, DiagLogLevel } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import { Resource } from '@opentelemetry/resources';
import {
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { FileTraceExporter } from 'opentelemetry-exporter-trace-otlp-file';

import { otelLogger } from './config/logger/open-telemetry.js';
import { resourceAttributes } from './config/open-telemetry.js';

class PatchedFileTraceExporter extends FileTraceExporter {
  // eslint-disable-next-line class-methods-use-this
  convert(spans: ReadableSpan[]) {
    const arrayBuffer = JsonTraceSerializer.serializeRequest(spans);
    if (!arrayBuffer)
      return {};
    return JSON.parse(Buffer.from(arrayBuffer).toString()) as object;
  }
}

const {
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
} = process.env;

diag.setLogger(otelLogger, DiagLogLevel.VERBOSE);

const inMemoryMetricExporter = new InMemoryMetricExporter(1);
const fileStream = createWriteStream('open-telemetry-metrics.log', { flags: 'a' });

const sdk = new NodeSDK({
  resource: new Resource(resourceAttributes),
  traceExporter: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ? new OTLPTraceExporter({
    url: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  }) // : new ConsoleSpanExporter(),
    : new PatchedFileTraceExporter({ filePath: 'open-telemetry-traces.log' }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ? new OTLPMetricExporter({
      url: OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    }) : inMemoryMetricExporter,
    exportIntervalMillis: 10000,
  }),
  instrumentations: [
    new PgInstrumentation(),
    new HttpInstrumentation(),
    /** @link https://github.com/open-telemetry/opentelemetry-js-contrib/issues/2435 */
    new ExpressInstrumentation({
      requestHook() {
        console.log('requestHook');
      },
    }),
  ],
});

let interval: NodeJS.Timeout;

function shutdown() {
  sdk.shutdown()
    .then(() => { console.log('Tracing terminated'); })
    .catch((error: unknown) => { console.log('Error terminating tracing', error); })
    .finally(() => process.exit(0));
  clearInterval(interval);
}

export default function start() {
  process.on('SIGTERM', shutdown);
  sdk.start();

  const hostMetrics = new HostMetrics();
  hostMetrics.start();

  interval = setInterval(() => {
    const metrics = inMemoryMetricExporter.getMetrics();
    metrics.forEach(metric => {
      fileStream.write(`${new Date().toISOString()} ${JSON.stringify(metric)}\n`, err => {
        if (err)
          otelLogger.warn('Error writing to file: %s', err);
        else
          otelLogger.info('Metrics appended to file: %d', metrics.length);
      });
    });
    inMemoryMetricExporter.reset();
  }, 1000);
}
