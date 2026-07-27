export type WeatherProviderErrorKind =
  | 'network'
  | 'http'
  | 'invalid-json'
  | 'invalid-response'
  | 'aborted'

export class WeatherProviderError extends Error {
  readonly kind: WeatherProviderErrorKind
  readonly status?: number

  constructor(
    kind: WeatherProviderErrorKind,
    message: string,
    options?: ErrorOptions & { readonly status?: number },
  ) {
    super(message, options)
    this.name = 'WeatherProviderError'
    this.kind = kind
    this.status = options?.status
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof WeatherProviderError && error.kind === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}
