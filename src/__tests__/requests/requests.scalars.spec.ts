import express from 'express'
import { createSchemaExecutor } from '../../graphQLExecutor'
import request from 'supertest'
import { addMocksToSchema } from '@graphql-tools/mock'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { customScalarSchema, Scalars } from '../fixtures'
import { createOpenAPIGraphQLBridge } from '../../bridge'
import { gql } from 'graphql-tag'

const app = express()

export const gqlSchema = addMocksToSchema({
  mocks: {
    Date: () => '10-10-1985',
    Datetime: () => '10-10-1985:10:00:00',
    JSON: () => JSON.stringify({}),
  },
  schema: makeExecutableSchema({
    typeDefs: customScalarSchema,
  }),
})
const customScalarBridge = createOpenAPIGraphQLBridge({
  graphqlDocument: gql`
    query getData @OAOperation(path: "/data") {
      getData {
        id
        created
        data
        modified
      }
    }
    mutation storeData($input: DataInput!) @OAOperation(path: "/data") {
      storeData(data: $input) {
        id
        created
        modified
      }
    }
  `,
  graphqlSchema: customScalarSchema,
  customScalars: (name: string) => Scalars[name],
})

app.use(customScalarBridge.getExpressMiddleware(createSchemaExecutor(gqlSchema)))

describe('Requests with custom scalars', () => {
  it('should GET `/data`', async () => {
    const result = await request(app).get('/data')
    expect(result.body).toMatchSnapshot({
      getData: [
        {
          id: expect.any(Number),
        },
        {
          id: expect.any(Number),
        },
      ],
    })
  })
})
