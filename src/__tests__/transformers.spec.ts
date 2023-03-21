import schema from './schema/schema.graphql'
import { buildASTSchema } from 'graphql'
import { createOpenAPIGraphQLBridge } from '../express.js'
import { bridgeFixtures } from './fixtures.js'
import { removeCustomProperties, transform } from '../index.js'
import { OpenAPIV3 } from 'openapi-types'

const graphqlSchema = buildASTSchema(schema)

const baseSchema: Partial<OpenAPIV3.Document> = {
  openapi: '3.0.3',
  info: {
    title: 'Sample API',
    version: '1.0.0',
    description: 'My API',
  },
  components: {
    securitySchemes: {
      OAuth2: {
        type: 'oauth2',
        flows: {
          password: {
            scopes: {
              'write:admin': 'Grants admin access',
            },
            tokenUrl: 'http://some-token-url',
            refreshUrl: 'http://some-refresh-token-url',
          },
        },
      },
    },
  },
}

describe('Schema Transformations', () => {
  const bridge = createOpenAPIGraphQLBridge({
    graphqlDocument: bridgeFixtures,
    graphqlSchema,
  })

  it('should be able to remove custom properties', () => {
    const schema = bridge.getOpenAPISchema({
      baseSchema,
      transform: removeCustomProperties,
    })

    expect(schema).toMatchSnapshot()
  })

  it('should handle multiple transformations', () => {
    const schema = bridge.getOpenAPISchema({
      baseSchema,
      transform: transform(removeCustomProperties, (bridgeOperation, operation) => {
        return {
          ...operation,
          responses: {
            ...operation.responses,
            '401': {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
            },
          },
        }
      }),
    })
    expect(schema).toMatchSnapshot()
  })

  it('should not allow to mutate a schema', () => {
    expect(() =>
      bridge.getOpenAPISchema({
        baseSchema,
        transform: (bridgeOperation, operation) => {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          delete operation.responses
          return operation
        },
      })
    ).toThrow(`Cannot delete property 'responses' of #<Object>`)
  })
})
