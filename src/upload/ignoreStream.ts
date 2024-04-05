// credits: https://github.com/jaydenseric/graphql-upload/blob/master/ignoreStream.mjs

import { Readable } from 'node:stream'

export default function ignoreStream(stream: Readable) {
  // Prevent an unhandled error from crashing the process.
  stream.on('error', () => {})

  // Waste the stream.
  stream.resume()
}
