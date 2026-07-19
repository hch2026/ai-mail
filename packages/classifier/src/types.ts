import type { Classification, TaxonomyLabel } from "@mail-ai/shared";

export interface ClassificationInput {
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  sentAt: string | null;
  isUnread: boolean;
  flags: string[];
  imapLabels: string[];
  preview: string | null;
  bodyText?: string | null;
}

export interface ClassificationResult {
  classification: Classification;
  source: "ai" | "rule";
  modelVersion: string;
  rawResult: string;
}

export interface EmailClassifier {
  classify(input: ClassificationInput, taxonomy?: readonly TaxonomyLabel[]): Promise<ClassificationResult>;
}

export interface AiClassifierOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}
