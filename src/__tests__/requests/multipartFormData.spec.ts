import express from 'express'
import { buildASTSchema } from 'graphql'
import { gql } from 'graphql-tag'
import { addMocksToSchema } from '@graphql-tools/mock'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { createOpenAPIGraphQLBridge } from '../../express.js'
import { OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import processRequest from 'graphql-upload/processRequest.mjs'
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs'
import { FileUpload } from 'graphql-upload/Upload.mjs'
import { execute, parse } from 'graphql/index.js'
import assert from 'node:assert'
import { Readable } from 'node:stream'

const app = express()

const schema = buildASTSchema(gql`
  scalar Upload

  type Mutation {
    uploadAFile(id: Int!, file: Upload!): String!
    uploadAMaybeFile(id: Int!, optionalFile: Upload): Boolean!
    uploadMixedFiles(id: Int!, optionalFile: Upload, requiredFile: Upload!): [String!]!
    uploadMultipleFiles(id: String!, primaryImage: Upload!, secondaryImage: Upload!): [String!]!
  }

  type Query {
    myQuery: Boolean
  }

  schema {
    mutation: Mutation
    query: Query
  }
`)

async function streamToString(stream: Readable) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

const gqlSchema = addMocksToSchema({
  resolvers: {
    Upload: GraphQLUpload,
    Mutation: {
      uploadAFile: async (root: unknown, { file }: { file: Promise<FileUpload> }) => {
        return await streamToString((await file).createReadStream())
      },
      uploadMixedFiles: async (
        root: unknown,
        { requiredFile }: { requiredFile: Promise<FileUpload>; optionalFile: Promise<FileUpload> }
      ) => {
        // This is an edge case, technically the spec forbids this case / did not think about it.
        // We could have a timeout on the optional file and ignore it if it was not transmitted within a certain
        // time window
        const result = await requiredFile
        return [await streamToString(result.createReadStream())]
      },
      uploadMultipleFiles: async (
        root: unknown,
        {
          primaryImage,
          secondaryImage,
        }: { primaryImage: Promise<FileUpload>; secondaryImage: Promise<FileUpload> }
      ) => {
        const firstFile = await streamToString((await primaryImage).createReadStream())
        const secondFile = await streamToString((await secondaryImage).createReadStream())
        return [firstFile, secondFile]
      },
    },
  },
  schema: makeExecutableSchema({
    typeDefs: schema,
  }),
  preserveResolvers: true,
})

const scalars: Record<string, OpenAPIV3.SchemaObject> = {
  Upload: {
    type: 'string',
    format: 'binary',
  },
}

const bridge = createOpenAPIGraphQLBridge({
  graphqlSchema: gqlSchema,
  customScalars: (scalarTypeName: string) => scalars[scalarTypeName]!,
  graphqlDocument: gql`
    mutation uploadFile($id: Int!, $file: Upload! @OABody(contentType: MULTIPART_FORM_DATA))
    @OAOperation(path: "/upload-file/{id}") {
      uploadAFile(id: $id, file: $file)
    }

    mutation uploadMultipleFiles(
      $id: String!
      $primaryImage: Upload! @OABody(contentType: MULTIPART_FORM_DATA)
      $secondaryImage: Upload! @OABody(contentType: MULTIPART_FORM_DATA, path: "secondary")
    ) @OAOperation(path: "/upload-multiple-images/{id}") {
      uploadMultipleFiles(id: $id, primaryImage: $primaryImage, secondaryImage: $secondaryImage)
    }

    mutation uploadSingleOptionalFile(
      $id: Int!
      $optionalFile: Upload @OABody(contentType: MULTIPART_FORM_DATA)
    ) @OAOperation(path: "/optional-file/{id}") {
      uploadAMaybeFile(id: $id, optionalFile: $optionalFile)
    }
    mutation uploadMixedOptionalFile(
      $id: Int!
      $requiredFile: Upload! @OABody(contentType: MULTIPART_FORM_DATA)
      $optionalFile: Upload @OABody(contentType: MULTIPART_FORM_DATA)
    ) @OAOperation(path: "/mixed-optional-file/{id}") {
      uploadMixedFiles(id: $id, requiredFile: $requiredFile, optionalFile: $optionalFile)
    }
  `,
})
app.use(
  bridge.getExpressMiddleware(async ({ request, response, document, variables }) => {
    // handle non-multipart (default) graphql requests
    if (!request.is('multipart/form-data')) {
      return Promise.resolve(
        execute({
          schema: gqlSchema,
          document: parse(document),
          variableValues: variables,
        })
      )
    }
    // Process our multipart request and make sure files resolve
    const uploadRequest = await processRequest(request, response)
    // we do not support batching requests, so we can safely assume a single request
    assert(!Array.isArray(uploadRequest))
    return Promise.resolve(
      execute({
        schema: gqlSchema,
        document: parse(uploadRequest.query),
        variableValues: {
          ...variables,
          ...(uploadRequest.variables as Record<string, unknown>),
        },
      })
    )
  })
)

describe('FormData', () => {
  it('should create the correct schema', () => {
    expect(
      bridge.getOpenAPISchema({
        baseSchema: {
          openapi: '3.0.3',
          info: {
            title: 'The API',
            version: '1.0.0',
            description: 'Description',
          },
        },
      })
    ).toMatchSnapshot()
  })
  it('should support multipart form data requests with a single file', async () => {
    const buffer = Buffer.from('some data')
    const result = await request(app)
      .post('/upload-file/10')
      .attach('file', buffer, 'custom_file_name.txt')
    expect(result.body).toMatchSnapshot()
  })

  it('should support uploading multiple files', async () => {
    const buffer1 = Buffer.from('firstImage')
    const buffer2 = Buffer.from('secondImage')

    const result = await request(app)
      .post('/upload-multiple-images/10')
      .attach('primaryImage', buffer1, 'custom_file_name.txt')
      .attach('secondary', buffer2, 'custom_file_name.txt')

    expect(result.body).toMatchSnapshot()
  })

  it('should allow single optional files', async () => {
    const result = await request(app).post('/optional-file/5').send({})
    expect(result.body).toMatchSnapshot({
      uploadAMaybeFile: expect.any(Boolean),
    })
  })

  it('should throw if optional file was transmitted as `multipart/form-data`', async () => {
    await request(app)
      .post('/optional-file/5')
      .set('content-type', 'multipart/form-data')
      .expect(500)
  })

  it('should allow mixed optional files', async () => {
    // this use case is not covered by the spec and has to be handled in the implementation
    // However we still allow it
    const buffer = Buffer.from('the required file')
    const result = await request(app)
      .post('/mixed-optional-file/5')
      .attach('requiredFile', buffer, 'required_file.txt')
    expect(result.body).toMatchSnapshot()
  })

  it('should not support arrays marked with `MULTIPART_FORM_DATA`', async () => {
    // todo..
  })
})
