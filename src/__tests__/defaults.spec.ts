import schema from './schema/schema-with-defaults.graphql'
import { buildASTSchema } from 'graphql'
import { OpenAPIV3 } from 'openapi-types'
import { createOpenAPIGraphQLBridge } from '../express.js'
import { gql } from 'graphql-tag'
import { addMocksToSchema } from '@graphql-tools/mock'
import { makeExecutableSchema } from '@graphql-tools/schema'
import request from 'supertest'
import express from 'express'
import { createSchemaExecutor } from '../graphQLExecutor.js'

export const graphqlSchema = buildASTSchema(schema)

const baseSchema: Partial<OpenAPIV3.Document> = {
  openapi: '3.0.3',
  info: {
    title: 'Sample API',
    version: '1.0.0',
    description: 'My API',
  },
}

describe('Schema with defaults', () => {
  it('should handle non-nullable default arguments', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlSchema,
      graphqlDocument: gql`
        mutation createSample($sample: SampleInputWithDefaults! @OABody)
        @OAOperation(path: "/sample") {
          createSample(input: $sample)
        }
      `,
    })

    expect(
      bridge.getOpenAPISchema({
        baseSchema,
        validate: true,
      })
    ).toMatchSnapshot()
  })
  it('should handle non-nullable defaults as not required', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlSchema,
      graphqlDocument: gql`
        query getSample($id: Int! = 10) @OAOperation(path: "/sample") {
          getSample(id: $id)
        }
      `,
    })

    expect(
      bridge.getOpenAPISchema({
        baseSchema,
        validate: true,
      })
    ).toMatchSnapshot()
  })

  it('should handle optional parameters', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlSchema,
      graphqlDocument: gql`
        query optionalParameter($id: Int) @OAOperation(path: "/sample") {
          optionalParameter(id: $id)
        }
      `,
    })

    expect(
      bridge.getOpenAPISchema({
        baseSchema,
        validate: true,
      })
    ).toMatchSnapshot()
  })

  it('should GET `/optional-sample`', async () => {
    const gqlSchema = addMocksToSchema({
      schema: makeExecutableSchema({ typeDefs: graphqlSchema }),
      resolvers: {
        Query: {
          getSampleWithOptional(source, args) {
            return `My name is ${args?.name === undefined ? 'not-defined' : args?.name}`
          },
        },
      },
    })
    const app = express()

    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: gql`
        query getOptionalSample($name: String) @OAOperation(path: "/sample-optional") {
          getSampleWithOptional(name: $name)
        }
      `,
      graphqlSchema,
    })

    app.use(
      bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema), {
        validateResponse: true,
        validateRequest: true,
      })
    )
    const response = await request(app).get('/sample-optional')
    expect(response.body).toMatchObject({
      getSampleWithOptional: 'My name is not-defined',
    })
    const secondResponse = await request(app).get('/sample-optional?name=David')
    expect(secondResponse.body).toMatchObject({
      getSampleWithOptional: 'My name is David',
    })
  })
})
