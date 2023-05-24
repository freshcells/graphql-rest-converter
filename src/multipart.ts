import { IncomingMessage } from 'node:http'
import { Transform } from 'node:stream'

// see https://www.rfc-editor.org/rfc/rfc7578#section-4.1
// We have to use CRLF (\r\n) to separate each chunk
export const createMultipartContentDispositionBuffer = (name: string, value: string) => {
  return Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
}

export const getBoundaryByRequest = (req: IncomingMessage) => {
  return (req.headers['content-type'] as string)?.match?.(/boundary=(.*)/)?.[1]
}

export const createBoundaryBuffer = (boundary: string) => Buffer.from(`\r\n--${boundary}\r\n`)

export const transformRequest = <R extends IncomingMessage = IncomingMessage>(
  req: R,
  graphqlOperation: string,
  allRequestBodyVariables: string[],
  requestBodyVariableMap: Record<string, string>
) => {
  const boundary = getBoundaryByRequest(req)
  if (!boundary) {
    return {}
  }
  const boundaryBuffer = createBoundaryBuffer(boundary)
  const map = JSON.stringify(
    Object.fromEntries(
      allRequestBodyVariables.map((variable) => [
        requestBodyVariableMap[variable],
        [`variables.${variable}`],
      ])
    )
  )
  const mapBuffer = createMultipartContentDispositionBuffer('map', map)
  const variables = Object.fromEntries(allRequestBodyVariables.map((variable) => [variable, null]))
  const operationsBuffer = createMultipartContentDispositionBuffer(
    'operations',
    JSON.stringify({
      query: graphqlOperation,
      variables,
    })
  )

  let operationAdded = false

  const transformStream = new Transform({
    transform(chunk, encoding, callback) {
      let nextChunk = chunk
      if (!operationAdded) {
        nextChunk = Buffer.concat([
          boundaryBuffer,
          operationsBuffer,
          boundaryBuffer,
          mapBuffer,
          chunk,
        ])
        operationAdded = true
      }
      callback(null, nextChunk)
    },
  })

  req.headers['content-length'] = String(
    parseInt(req.headers['content-length'] || '0', 10) +
      boundaryBuffer.length +
      mapBuffer.length +
      boundaryBuffer.length +
      operationsBuffer.length
  )

  // Pipes the request stream through the transformation stream
  const next = req.pipe(transformStream)
  // make sure our transformation is applied on the next request transformer
  req.pipe = (destination, options) => {
    return next.pipe(destination, options)
  }
  return variables
}
