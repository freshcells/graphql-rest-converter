import { IncomingMessage } from 'node:http'
import { Transform } from 'node:stream'
import busboy from "busboy"

// see https://www.rfc-editor.org/rfc/rfc7578#section-4.1
// We have to use CRLF (\r\n) to separate each chunk
export const createMultipartContentDispositionBuffer = (name: string, value: string) => {
  return Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
}

export const getBoundaryByRequest = (req: IncomingMessage) => {
  const match = (req.headers['content-type'] as string)?.match?.(/boundary=(?:"([^"]+)"|([^;]+))/i)
  const [, withQuotes, withoutQuotes] = match || []
  return withQuotes || withoutQuotes
}

export const getFileVars = (chunkString: string, requestBodyVariableMap: Record<string, string>) => {
  const regex = (/Content-Disposition: form-data; name=(?:"([^"]+)"|([^;]+)); filename=(?:"([^"]+)"|([^;]+))/ig)
  let match = regex.exec(chunkString)
  const matches = {} as Record<string, string | string[]>
  while (match != null) {
    const requestBodyVarValue = requestBodyVariableMap[match[1]]
    if (requestBodyVarValue) {
      const isArray = Array.isArray(requestBodyVarValue)
      if (isArray) {
        matches[match[1]] = [...(matches[match[1]] || []), match[3]]
      } else {
        matches[match[1]] = match[3]
      }
    }
    match = regex.exec(chunkString);
  }
  return matches
}

export const createBoundaryBuffer = (boundary: string) => Buffer.from(`\r\n--${boundary}\r\n`)

export const transformRequest2 = <R extends IncomingMessage = IncomingMessage>(
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
  const variables = Object.fromEntries(Object.entries(requestBodyVariableMap).map(([k, v]) => [k, Array.isArray(v) ? [null] : null]))

  const createOperationBuffer = (fileVars: Record<string, string | string[]>) => {
    const variables = Object.fromEntries(Object.entries(requestBodyVariableMap).map(([k]) => {
      let operationVariable = null
      const fileVarValue  = fileVars[k]
      if (Array.isArray(fileVarValue)) {
        operationVariable = fileVarValue.map(() => null)
      }
      return [k, operationVariable]
    }))
    return createMultipartContentDispositionBuffer(
      'operations',
      JSON.stringify({
        query: graphqlOperation,
        variables,
      })
    )
  }

  const createMapBuffer = (fileVars: Record<string, string | string[]>) => {
    const mapAsArr = [] as (string | string[])[][]
    allRequestBodyVariables.forEach((variable) => {
      const fileVarValue  = fileVars[variable]
      if (Array.isArray(fileVarValue)) {
        fileVarValue.forEach((__, index) => {
          mapAsArr.push([`${requestBodyVariableMap[variable]}${index}`, [`variables.${variable}.${index}`]])
        })
      } else {
        mapAsArr.push([requestBodyVariableMap[variable], [`variables.${variable}`]])
      }
      return [
        requestBodyVariableMap[variable],
        [`variables.${variable}`],
      ]
    })
    const map = JSON.stringify(Object.fromEntries(mapAsArr))
    return createMultipartContentDispositionBuffer('map', map);
  }

  let operationAdded = false
  const transformStream = new Transform({
    transform(chunk, encoding, callback) {
      let nextChunk = chunk
      if (!operationAdded) {
        const chunkString = chunk.toString('utf-8')
        const fileVars = getFileVars(chunkString, requestBodyVariableMap) // Should we add boundary check?
        const operationsBuffer = createOperationBuffer(fileVars)
        const mapBuffer = createMapBuffer(fileVars)
        nextChunk = Buffer.concat([
          boundaryBuffer,
          operationsBuffer,
          boundaryBuffer,
          mapBuffer,
          Buffer.from(chunkString, 'utf8')
        ])
        console.log("NextChunk: " + nextChunk.toString('utf-8'))

        console.log("before content-length: " + req.headers['content-length'])
        req.headers['content-length'] = String(
          // parseInt(req.headers['content-length'] || '0', 10) +
            boundaryBuffer.length +
            mapBuffer.length +
            boundaryBuffer.length +
            operationsBuffer.length
            + chunk.length
        )
        console.log("after content-length: " + req.headers['content-length'])

        operationAdded = true
      }
      callback(null, nextChunk)
    },
  })

  // Pipes the request stream through the transformation stream
  const next = req.pipe(transformStream)
  // make sure our transformation is applied on the next request transformer
  req.pipe = (destination, options) => {
    return next.pipe(destination, options)
  }
  return variables
}

export const transformRequest1 = <R extends IncomingMessage = IncomingMessage>( // It's better to integrate busboy streaming rather than memory processing
  req: R,
) => {
  const parser = busboy({
    headers: req.headers,
    defParamCharset: "utf8",
    limits: {
      fileSize: Infinity,
      files: Infinity,
    },
  });

  parser.on("file", (fieldName, stream, { filename, encoding, mimeType: mimetype }) => {
    console.log("busboy on file fieldName: " + fieldName)
  });

  req.pipe(parser)
}


export const transformRequest = <R extends IncomingMessage = IncomingMessage>(
  req: R,
  graphqlOperation: string,
  allRequestBodyVariables: string[],
  requestBodyVariableMap: Record<string, string>
) => {
  transformRequest1(req);
  return transformRequest2(req, graphqlOperation, allRequestBodyVariables, requestBodyVariableMap);
}