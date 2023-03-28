// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { IncomingMessage } from 'node:http'

declare module 'node:http' {
  interface ParsedQs {
    [key: string]: undefined | string | string[] | ParsedQs | ParsedQs[]
  }

  interface IncomingMessage {
    body?: Record<string, unknown>
    query: ParsedQs
    cookies: Record<string, string>
    params: Record<string, string>

    is(type: string | string[]): string | false | null
  }
}
