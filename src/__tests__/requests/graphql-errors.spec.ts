import { bridgeFixtures, bridge, gqlSchema, graphqlSchema } from '../bridgeFixtures'
import express from 'express'
import { createSchemaExecutor } from '../../graphQLExecutor'
import request from 'supertest'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { createOpenAPIGraphQLBridge } from '../../bridge'

describe('GraphQL Errors', () => {
  it('should forward any gql error if validation is not configured', async () => {
    const app = express()

    app.use(
      bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema), {
        validateResponse: false,
        validateRequest: false,
      })
    )
    const response = await request(app).get('/sample/not-a-number').expect(500)
    expect(response.body).toMatchSnapshot()
  })
  it('should forward server errors if response validation is disabled', async () => {
    const app = express()

    const gqlSchema = makeExecutableSchema({
      typeDefs: graphqlSchema,
      resolvers: {
        Query: {
          async getSample() {
            throw new Error('Unable to process request.')
          },
        },
      },
    })

    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: bridgeFixtures,
      graphqlSchema: gqlSchema,
    })

    app.use(
      bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema), {
        validateRequest: true,
        validateResponse: false,
      })
    )
    const response = await request(app).get('/sample/1').expect(500)
    expect(response.body).toMatchSnapshot()
  })
})
