import express from 'express'
import { buildASTSchema } from 'graphql'
import { gql } from 'graphql-tag'
import { addMocksToSchema } from '@graphql-tools/mock'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { createOpenAPIGraphQLBridge } from '../../express.js'
import request from 'supertest'
import { createSchemaExecutor } from '../../graphQLExecutor.js'

const app = express()

const schema = buildASTSchema(gql`
  type Mutation {
    someMutation(id: Int!, someParameter: String!): String!
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
  schema: makeExecutableSchema({
    typeDefs: schema,
  }),
})
const bridge = createOpenAPIGraphQLBridge({
  graphqlSchema: gqlSchema,
  graphqlDocument: gql`
    mutation fetch($id: Int!, $someParameter: String! @OABody(contentType: FORM_DATA))
    @OAOperation(path: "/fetch") {
      someMutation(id: $id, someParameter: $someParameter)
    }
  `,
})

app.use(bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema)))

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
  it('should only support form-data requests', async () => {
    const result = await request(app).post('/fetch?id=5').expect(415)
    expect(result.body).toMatchSnapshot()
  })
  it('should validate form data requests', async () => {
    const result = await request(app).post('/fetch?id=5').type('form').expect(400)
    expect(result.body).toMatchSnapshot()
  })
  it('should POST `/fetch` successful', async () => {
    const result = await request(app).post('/fetch?id=5').type('form').send('someParameter=nice')
    expect(result.body).toMatchSnapshot()
  })
})
