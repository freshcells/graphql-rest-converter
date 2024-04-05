import express from 'express'
import { buildASTSchema } from 'graphql'
import { gql } from 'graphql-tag'
import { addMocksToSchema } from '@graphql-tools/mock'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { createOpenAPIGraphQLBridge } from '../../express.js'
import request from 'supertest'
import { execute, parse } from 'graphql'
import assert from 'node:assert'
import { GraphQLUpload, GraphQLUploads } from '../../graphql-upload/scalars.js'
import { FileUpload, processRequest } from '../../graphql-upload/processRequest.js'
import { text } from 'node:stream/consumers'
import { UploadScalars } from '../../types.js'

const app = express()

const schema = buildASTSchema(gql`
  scalar Upload
  scalar Uploads

  type Mutation {
    uploadAFile(id: Int!, file: Upload!): String!
    uploadAMaybeFile(id: Int!, optionalFile: Upload): Boolean!
    uploadMixedFiles(id: Int!, optionalFile: Upload, requiredFile: Upload!): [String!]!
    uploadMultipleFiles(id: String!, primaryImage: Upload!, secondaryImage: Upload!): [String!]!
    uploadAnArrayOfFiles(id: String!, images: Uploads!): [String!]!
    uploadAnArrayOfFilesAndASingleFile(
      id: String!
      otherFiles: Uploads!
      coverPicture: Upload!
    ): [String!]!
    uploadOptionalFiles(id: String!, otherFiles: Uploads): [String!]!
    uploadOptionalFilesAndFile(id: String!, otherFiles: Uploads, coverPicture: Upload): [String!]!
  }

  type Query {
    myQuery: Boolean
  }

  schema {
    mutation: Mutation
    query: Query
  }
`)

const gqlSchema = addMocksToSchema({
  resolvers: {
    Upload: GraphQLUpload,
    Uploads: GraphQLUploads,
    Mutation: {
      uploadAFile: async (root: unknown, { file }: { file: Promise<FileUpload> }) => {
        return await text((await file).createReadStream())
      },
      uploadMixedFiles: async (
        root: unknown,
        { requiredFile }: { requiredFile: Promise<FileUpload>; optionalFile: Promise<FileUpload> },
      ) => {
        // This is an edge case, technically the spec forbids this case / did not think about it.
        // We could have a timeout on the optional file and ignore it if it was not transmitted within a certain
        // time window
        const result = await requiredFile
        return [await text(result.createReadStream())]
      },
      uploadMultipleFiles: async (
        root: unknown,
        {
          primaryImage,
          secondaryImage,
        }: { primaryImage: Promise<FileUpload>; secondaryImage: Promise<FileUpload> },
      ) => {
        const firstFile = await text((await primaryImage).createReadStream())
        const secondFile = await text((await secondaryImage).createReadStream())
        return [firstFile, secondFile]
      },
      uploadAnArrayOfFiles: async (
        root: unknown,
        { images }: { images: AsyncGenerator<FileUpload> },
      ) => {
        const result = []
        for await (const image of images) {
          result.push(await text(image.createReadStream()))
        }
        return result
      },
      uploadAnArrayOfFilesAndASingleFile: async (
        root: unknown,
        {
          otherFiles,
          coverPicture,
        }: { otherFiles: AsyncGenerator<FileUpload>; coverPicture: Promise<FileUpload> },
      ) => {
        const result = []

        result.push(await text((await coverPicture).createReadStream()))
        for await (const file of otherFiles) {
          result.push(await text(file.createReadStream()))
        }
        return result
      },
      uploadOptionalFiles: async (
        root: unknown,
        { otherFiles }: { otherFiles: AsyncGenerator<FileUpload> },
      ) => {
        const result = []

        for await (const file of otherFiles) {
          result.push(await text(file.createReadStream()))
        }
        return result
      },
      uploadOptionalFilesAndFile: async (
        root: unknown,
        {
          otherFiles,
          coverPicture,
        }: { otherFiles: AsyncGenerator<FileUpload>; coverPicture: Promise<FileUpload | null> },
      ) => {
        const result = []

        const picture = await coverPicture

        assert(null === picture)
        for await (const file of otherFiles) {
          result.push(await text(file.createReadStream()))
        }
        return result
      },
    },
  },
  schema: makeExecutableSchema({
    typeDefs: schema,
  }),
  preserveResolvers: true,
})

const bridge = createOpenAPIGraphQLBridge({
  graphqlSchema: gqlSchema,
  customScalars: (scalarTypeName: string) => UploadScalars[scalarTypeName]!,
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
    mutation uploadAnArrayOfFiles(
      $id: String!
      $images: Uploads! @OABody(contentType: MULTIPART_FORM_DATA)
    ) @OAOperation(path: "/upload-an-array-of-files/{id}") {
      uploadAnArrayOfFiles(id: $id, images: $images)
    }
    mutation uploadAnArrayOfFilesAndASingleFile(
      $id: String!
      $files: Uploads! @OABody(contentType: MULTIPART_FORM_DATA)
      $coverImage: Upload! @OABody(contentType: MULTIPART_FORM_DATA)
    ) @OAOperation(path: "/upload-arrays-and-single/{id}") {
      uploadAnArrayOfFilesAndASingleFile(id: $id, otherFiles: $files, coverPicture: $coverImage)
    }
    mutation uploadOptionalFiles(
      $id: String!
      $files: Uploads @OABody(contentType: MULTIPART_FORM_DATA)
    ) @OAOperation(path: "/upload-optional-files/{id}") {
      uploadOptionalFiles(id: $id, otherFiles: $files)
    }
    mutation uploadOptionalFilesAndFile(
      $id: String!
      $files: Uploads @OABody(contentType: MULTIPART_FORM_DATA)
      $coverPicture: Upload @OABody(contentType: MULTIPART_FORM_DATA)
    ) @OAOperation(path: "/upload-optional-files-and-file/{id}") {
      uploadOptionalFilesAndFile(id: $id, otherFiles: $files, coverPicture: $coverPicture)
    }
  `,
})
app.use(
  bridge.getExpressMiddleware(async ({ request, response, document, variables }) => {
    // handle non-multipart (default) graphql requests
    if (!request.is('multipart/form-data')) {
      return execute({
        schema: gqlSchema,
        document: parse(document),
        variableValues: variables,
      })
    }
    // Process our multipart request and make sure files resolve
    const { operations: uploadRequest, parsedDocuments } = await processRequest(request, response, {
      maxFiles: 5,
      maxFileSize: 1000,
    })
    // we do not support batching requests, so we can safely assume a single request
    assert(!Array.isArray(uploadRequest))
    return execute({
      schema: gqlSchema,
      document: parsedDocuments[0],
      variableValues: {
        ...variables,
        ...uploadRequest.variables,
      },
    })
  }),
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
      }),
    ).toMatchSnapshot()
  })
  it('should support multipart form data requests with a single file', async () => {
    const buffer = Buffer.from('some data')
    const result = await request(app)
      .post('/upload-file/10')
      .attach('file', buffer, 'custom_file_name.txt')
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })

  it('should fail if a single file is too big', async () => {
    const result = await request(app)
      .post('/upload-file/10')
      .attach('file', Buffer.from('b'.repeat(1001)), 'custom_file_name.txt')
      .expect(500)
    expect(result.body).toMatchSnapshot()
  })

  it('should support uploading multiple files', async () => {
    const buffer1 = Buffer.from('firstImage')
    const buffer2 = Buffer.from('secondImage')

    const result = await request(app)
      .post('/upload-multiple-images/10')
      .attach('primaryImage', buffer1, 'custom_file_name.txt')
      .attach('secondary', buffer2, 'custom_file_name.txt')
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })

  it('should allow single optional files', async () => {
    const result = await request(app).post('/optional-file/5').send({}).expect(200)
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
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })

  it('should support an array of files`', async () => {
    const buffer1 = Buffer.from('first file')
    const buffer2 = Buffer.from('second file')

    const result = await request(app)
      .post('/upload-an-array-of-files/5')
      .attach('images', buffer1, 'first.txt')
      .attach('images', buffer2, 'second.txt')
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })
  it('should throw if no files where given`', async () => {
    const result = await request(app).post('/upload-an-array-of-files/5').expect(415)
    expect(result.body).toMatchSnapshot()
  })
  it('should ignore other files`', async () => {
    const buffer1 = Buffer.from('first file')
    const result = await request(app)
      .post('/upload-an-array-of-files/5')
      .attach('some-non-field', buffer1, 'first.txt')
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })
  it('should handle errors in case of too many files`', async () => {
    const result = await request(app)
      .post('/upload-an-array-of-files/5')
      .attach('images', Buffer.from('first file'), 'first.txt')
      .attach('images', Buffer.from('second file'), 'second.txt')
      .attach('images', Buffer.from('third file'), 'third.txt')
      .attach('images', Buffer.from('fourth file'), 'fourth.txt')
      .attach('images', Buffer.from('fifth file'), 'fifth.txt')
      .attach('images', Buffer.from('sixth file'), 'sixth.txt')
      .expect(500)
    expect(result.body).toMatchSnapshot()
  })
  it('should allow a mix of files and single file', async () => {
    const result = await request(app)
      .post('/upload-arrays-and-single/5')
      .attach('files', Buffer.from('first file'), 'first.txt')
      .attach('files', Buffer.from('second file'), 'second.txt')
      .attach('files', Buffer.from('third file'), 'third.txt')
      .attach('coverImage', Buffer.from('fourth file'), 'fourth.txt')
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })
  it('should fail if a file is too big', async () => {
    const result = await request(app)
      .post('/upload-arrays-and-single/5')
      .attach('files', Buffer.from('first file'), 'first.txt')
      .attach('files', Buffer.from('second file'), 'second.txt')
      .attach('files', Buffer.from('b'.repeat(1001)), 'third.txt')
      .attach('coverImage', Buffer.from('fourth file'), 'fourth.txt')
      .expect(500)
    expect(result.body).toMatchSnapshot()
  })
  it('should allow optional files', async () => {
    const result = await request(app)
      .post('/upload-optional-files/5')
      .field('some', 'value')
      .set('Content-Type', 'multipart/form-data')
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })
  it('should allow optional files and file in combination', async () => {
    const result = await request(app)
      .post('/upload-optional-files-and-file/5')
      .field('some', 'value')
      .set('Content-Type', 'multipart/form-data')
      .expect(200)
    expect(result.body).toMatchSnapshot()
  })
  it('should fail if a required file is missing', async () => {
    const result = await request(app)
      .post('/upload-file/10')
      .field('some', 'value')
      .set('Content-Type', 'multipart/form-data')
      .expect(500)
    expect(result.body).toMatchSnapshot()
  })
})
