import { AiClassifier } from "./ai-classifier.js";
import { RuleClassifier } from "./rule-classifier.js";
import type { EmailClassifier } from "./types.js";

export interface ClassifierConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  model?: string | undefined;
  timeoutMs: number;
}

export function createClassifier(config: ClassifierConfig): EmailClassifier {
  if (config.apiKey && config.model) {
    return new AiClassifier({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }
  return new RuleClassifier();
}
