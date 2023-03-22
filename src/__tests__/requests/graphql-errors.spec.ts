import { bridgeFixtures, bridge, gqlSchema, graphqlSchema } from '../fixtures.js'
import express, { ErrorRequestHandler } from 'express'
import { createSchemaExecutor } from '../../graphQLExecutor.js'
import request from 'supertest'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { createOpenAPIGraphQLBridge } from '../../express.js'

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
  it('should throw an exception if response validation is enabled', async () => {
    const app = express()

    app.use(
      bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema), {
        validateResponse: true,
        validateRequest: false,
      })
    )
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use(((err, req, res, next) => {
      res.status(500).send('Something is not right here!')
    }) as ErrorRequestHandler)

    const response = await request(app).get('/sample/not-a-number').expect(500)
    expect(response.text).toEqual('Something is not right here!')
  })
  it('should forward graphql server errors by default', async () => {
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

    app.use(bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema)))
    const response = await request(app).get('/sample/1').expect(500)
    expect(response.body).toMatchSnapshot()
  })

  describe('should handle malformed request bodies', () => {
    const app = express()

    app.use(
      bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema), {
        validateResponse: false,
        validateRequest: false,
      })
    )
    it('should handle malformed JSON bodies', async () => {
      const response = await request(app)
        .post('/sample')
        .set('content-type', 'application/json')
        .send(`{"}`)
        .expect(400)
      expect(response.body).toMatchSnapshot()
    })
  })
})
