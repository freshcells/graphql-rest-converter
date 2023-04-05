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
  it('should be able to remove custom properties', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: bridgeFixtures,
      graphqlSchema,
      transform: removeCustomProperties,
    })
    const schema = bridge.getOpenAPISchema({
      baseSchema,
    })

    expect(schema).toMatchSnapshot()
  })

  it('should handle multiple transformations', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: bridgeFixtures,
      graphqlSchema,
      transform: transform(removeCustomProperties, (operation) => {
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

    const schema = bridge.getOpenAPISchema({
      baseSchema,
    })
    expect(schema).toMatchSnapshot()
  })

  it('should not allow to mutate a schema', () => {
    expect(() => {
      const bridge = createOpenAPIGraphQLBridge({
        graphqlDocument: bridgeFixtures,
        graphqlSchema,
        transform: (operation) => {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          delete operation.responses
          return operation
        },
      })
      bridge.getOpenAPISchema({
        baseSchema,
      })
    }).toThrow(`Cannot delete property 'responses' of #<Object>`)
  })
})
