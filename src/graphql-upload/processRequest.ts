// credits: https://github.com/jaydenseric/graphql-upload/blob/master/processRequest.mjs

import busboy from 'busboy'
import { ReadStreamOptions, WriteStream } from 'fs-capacitor'
import createError from 'http-errors'
import ignoreStream from './ignoreStream.js'
import Upload from './Upload.js'
import { IncomingMessage, OutgoingMessage } from 'node:http'
import { AsyncQueue } from '../iterable.js'
import _ from 'lodash'
import { Kind, parse } from 'graphql'
import type { DocumentNode } from 'graphql/language/ast.js'
import { getAllVariablesFromDocuments } from './utils.js'

const GRAPHQL_MULTIPART_REQUEST_SPEC_URL =
  'https://github.com/jaydenseric/graphql-multipart-request-spec'

export interface FileUpload {
  filename: string
  mimetype: string
  encoding: string
  createReadStream: WriteStream['createReadStream']
  capacitor: WriteStream
}

interface Operation {
  query: string
  variables: Record<string, Upload | AsyncQueue<FileUpload>>
}

/**
 * Processes an incoming
 * [GraphQL multipart request](https://github.com/jaydenseric/graphql-multipart-request-spec).
 * It parses the `operations` and `map` fields to create an {@linkcode Upload}
 * instance for each expected file upload, placing references wherever the file
 * is expected in the GraphQL operation for the {@linkcode GraphQLUpload} scalar
 * to derive it’s value. Errors are created with
 * [`http-errors`](https://npm.im/http-errors) to assist in sending responses
 * with appropriate HTTP status codes. Used to create custom middleware.
 */
export function processRequest(
  request: IncomingMessage,
  response: OutgoingMessage,
  {
    maxFieldSize = 1000000, // 1 MB
    maxFileSize = Infinity,
    maxFiles = Infinity,
  } = {},
) {
  return new Promise<{ operations: Operation | Operation[]; parsedDocuments: DocumentNode[] }>(
    (resolve, reject) => {
      let released: boolean

      let exitError: Error

      let operations: Operation | Operation[]

      let parsedDocuments: DocumentNode[]

      let parsedMap: Record<string, string[]>

      let map: Map<string, Upload | AsyncQueue<FileUpload>>

      const parser = busboy({
        headers: request.headers,
        defParamCharset: 'utf8',
        limits: {
          fieldSize: maxFieldSize,
          fields: 2, // Only operations and map.
          fileSize: maxFileSize,
          files: maxFiles,
        },
      })

      /**
       * Exits request processing with an error. Successive calls have no effect.
       */
      function exit(error: Error, isParserError = false) {
        if (exitError) return

        exitError = error

        if (map)
          for (const upload of map.values()) {
            if (upload instanceof AsyncQueue) {
              upload.reject(exitError)
            }
            if (upload instanceof Upload) {
              if (!upload.value) {
                upload.reject?.(exitError)
              }
            }
          }

        // If the error came from the parser, don’t cause it to be emitted again.
        isParserError ? parser.destroy() : parser.destroy(exitError)

        request.unpipe(parser)

        // With a sufficiently large request body, subsequent events in the same
        // event frame cause the stream to pause after the parser is destroyed. To
        // ensure that the request resumes, the call to .resume() is scheduled for
        // later in the event loop.
        setImmediate(() => {
          request.resume()
        })

        reject(exitError)
      }

      parser.on('field', (fieldName, value, { valueTruncated }) => {
        if (valueTruncated)
          return exit(
            createError(
              413,
              `The ‘${fieldName}’ multipart field value exceeds the ${maxFieldSize} byte size limit.`,
            ),
          )

        switch (fieldName) {
          case 'operations':
            try {
              operations = JSON.parse(value)
            } catch (error) {
              return exit(
                createError(
                  400,
                  `Invalid JSON in the ‘operations’ multipart field (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                ),
              )
            }

            // `operations` should be an object or an array. Note that arrays
            // and `null` have an `object` type.
            if (typeof operations !== 'object' || !operations)
              return exit(
                createError(
                  400,
                  `Invalid type for the ‘operations’ multipart field (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                ),
              )

            try {
              const ops = Array.isArray(operations) ? operations : [operations]
              parsedDocuments = ops
                .filter((op) => typeof op.query !== 'undefined')
                .map((op) => parse(op.query))
            } catch (e) {
              return exit(
                createError(
                  400,
                  `Unable to parse graphql documents on ‘operations’: ${(e as Error).message}`,
                ),
              )
            }

            if (parsedDocuments.length === 0) {
              return exit(createError(400, `Missing ‘query’ field on operations.`))
            }

            break
          case 'map': {
            if (!operations)
              return exit(
                createError(
                  400,
                  `Misordered multipart fields; ‘map’ should follow ‘operations’ (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                ),
              )

            try {
              parsedMap = JSON.parse(value)
            } catch (error) {
              return exit(
                createError(
                  400,
                  `Invalid JSON in the ‘map’ multipart field (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                ),
              )
            }

            // `map` should be an object.
            if (typeof parsedMap !== 'object' || !parsedMap || Array.isArray(parsedMap))
              return exit(
                createError(
                  400,
                  `Invalid type for the ‘map’ multipart field (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                ),
              )

            const mapEntries = Object.entries(parsedMap)

            // Check max files is not exceeded, even though the number of files
            // to parse might not match the map provided by the client.
            if (mapEntries.length > maxFiles)
              return exit(createError(413, `${maxFiles} max file uploads exceeded.`))

            map = new Map()
            for (const [fieldName, paths] of mapEntries) {
              if (!Array.isArray(paths))
                return exit(
                  createError(
                    400,
                    `Invalid type for the ‘map’ multipart field entry key ‘${fieldName}’ array (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                  ),
                )

              const isArray = fieldName.includes('[]')
              const thisFieldName = isArray ? fieldName.replace('[]', '') : fieldName

              map.set(thisFieldName, isArray ? new AsyncQueue() : new Upload())

              for (const [index, path] of paths.entries()) {
                if (typeof path !== 'string')
                  return exit(
                    createError(
                      400,
                      `Invalid type for the ‘map’ multipart field entry key ‘${thisFieldName}’ array index ‘${index}’ value (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                    ),
                  )

                try {
                  _.set(operations, path, map.get(thisFieldName))
                } catch (error) {
                  return exit(
                    createError(
                      400,
                      `Invalid object path for the ‘map’ multipart field entry key ‘${thisFieldName}’ array index ‘${index}’ value ‘${path}’ (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
                    ),
                  )
                }
              }
            }

            resolve({ operations, parsedDocuments })
          }
        }
      })

      parser.on('file', (fieldName, stream, { filename, encoding, mimeType: mimetype }) => {
        if (!map) {
          ignoreStream(stream)
          return exit(
            createError(
              400,
              `Misordered multipart fields; files should follow ‘map’ (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
            ),
          )
        }

        const upload = map.get(fieldName)

        if (!upload) {
          // The file is extraneous. As the rest can still be processed, just
          // ignore it and don’t exit with an error.
          ignoreStream(stream)
          return
        }

        let fileError: Error

        const capacitor = new WriteStream()

        capacitor.on('error', () => {
          stream.unpipe()
          stream.resume()
        })

        stream.on('limit', () => {
          fileError = createError(
            413,
            `File truncated as it exceeds the ${maxFileSize} byte size limit.`,
          )
          stream.unpipe()
          capacitor.destroy(fileError)
        })

        stream.on('error', (error) => {
          fileError = error
          stream.unpipe()
          capacitor.destroy(fileError)
        })

        const file: FileUpload = {
          filename,
          mimetype,
          encoding,
          createReadStream(options?: ReadStreamOptions) {
            const error = fileError || (released ? exitError : null)
            if (error) throw error
            return capacitor.createReadStream(options)
          },
          capacitor,
        }

        Object.defineProperty(file, 'capacitor', {
          enumerable: false,
          configurable: false,
          writable: false,
        })

        stream.pipe(capacitor)

        if (upload instanceof AsyncQueue) {
          upload.add(file)
          return
        }
        upload.resolve?.(file)
      })

      parser.once('filesLimit', () =>
        exit(createError(413, `${maxFiles} max file uploads exceeded.`)),
      )

      parser.once('finish', () => {
        request.unpipe(parser)
        request.resume()

        if (!operations)
          return exit(
            createError(
              400,
              `Missing multipart field ‘operations’ (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
            ),
          )

        if (!map)
          return exit(
            createError(
              400,
              `Missing multipart field ‘map’ (${GRAPHQL_MULTIPART_REQUEST_SPEC_URL}).`,
            ),
          )

        const allVariables = getAllVariablesFromDocuments(parsedDocuments)

        for (const [fieldName, upload] of map.entries()) {
          if (upload instanceof AsyncQueue) {
            upload.terminate()
          }
          if (upload instanceof Upload) {
            if (!upload.value) {
              const variableDefinitions = parsedMap[fieldName]
                .map((path, index) => {
                  return allVariables[`${index}.${path}`]
                })
                .filter(Boolean)

              if (
                variableDefinitions.find((def) => {
                  return def.type.kind === Kind.NON_NULL_TYPE
                })
              ) {
                upload.reject?.(createError(400, 'File missing in the request.'))
                continue
              }
              upload.resolve?.(null)
            }
          }
        }
      })

      // Use the `on` method instead of `once` as in edge cases the same parser
      // could have multiple `error` events and all must be handled to prevent the
      // Node.js process exiting with an error. One edge case is if there is a
      // malformed part header as well as an unexpected end of the form.
      parser.on('error', (error: Error) => {
        exit(error, true)
      })

      response.once('close', () => {
        released = true
        if (map)
          for (const upload of map.values()) {
            if (upload instanceof AsyncQueue) {
              upload.processedItems.forEach((item) => {
                item.capacitor.release()
              })
            } else {
              if (upload.value) {
                // Release resources and clean up temporary files.
                upload.value.capacitor.release()
              }
            }
          }
      })

      request.once('close', () => {
        if (!request.readableEnded)
          exit(createError(499, 'Request disconnected during file upload stream parsing.'))
      })

      request.pipe(parser)
    },
  )
}
