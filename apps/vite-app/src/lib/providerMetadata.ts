import generatedProviderMetadata from "./providers.generated.json";

export type ProviderRole = keyof typeof generatedProviderMetadata.defaults;

export interface ProviderOption {
  readonly value: string;
  readonly label: string;
}

function providerOptionsForRole(role: ProviderRole): readonly ProviderOption[] {
  return generatedProviderMetadata.providers
    .filter((provider) => provider.role === role)
    .map((provider) => ({
      value: provider.id,
      label: provider.label,
    }));
}

export const STT_PROVIDER_OPTIONS = providerOptionsForRole("stt");
export const LLM_PROVIDER_OPTIONS = providerOptionsForRole("llm");
export const TTS_PROVIDER_OPTIONS = providerOptionsForRole("tts");
export const DEFAULT_PROVIDER_IDS = generatedProviderMetadata.defaults;
