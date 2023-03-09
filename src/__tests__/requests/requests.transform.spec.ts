import { bridge, gqlSchema } from '../fixtures'
import express from 'express'
import { createSchemaExecutor } from '../../graphQLExecutor'
import request from 'supertest'

const app = express()

app.use(
  bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema), {
    validateResponse: true,
    validateRequest: true,
    responseTransformer: async () => {
      return {
        statusCode: 200,
        contentType: 'application/text',
        data: 'Hello World',
      }
    },
  })
)

describe('Request transform', () => {
  it('should transform a request', async () => {
    const response = await request(app).get('/samples').expect(200)
    expect(response.text).toEqual('Hello World')
    expect(response.type).toEqual('application/text')
  })
})
