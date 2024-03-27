import schema from './schema/schema.graphql'
import { buildASTSchema } from 'graphql'
import { createOpenAPIGraphQLBridge } from '../express.js'
import { gql } from 'graphql-tag'
import { bridgeFixtures } from './fixtures.js'
import { getBridgeOperations } from '../graphql.js'
import { removeCustomProperties } from '../transformers.js'
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

describe('OpenAPI Generation', () => {
  describe('Bridge schema errors', () => {
    it('should throw for missing operation', () => {
      expect(() => {
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation mutateSomething($id: String @OAParam) {
              mutationWithoutDefaultArg(id: $id)
            }
          `,
        )
      }).toThrow(
        'Schema validation error(s): Missing required directive "@OAOperation" on operation "mutateSomething". Source: unknown',
      )
    })
    it('should throw for unsupported operations', () => {
      expect(() => {
        getBridgeOperations(
          graphqlSchema,
          gql`
            subscription mySubscription($id: Int!) @OAOperation(path: "/someOp") {
              sampleAdded(id: $id) {
                id
              }
            }
          `,
        )
      }).toThrow(
        'Schema validation error(s): Directive "@OAOperation" may not be used on SUBSCRIPTION. Source: unknown',
      )
    })

    it('should throw for generic gql errors', () => {
      expect(() => {
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation mutateSomething($test: Int!) @OAOperation(path: "/someOp") {
              mutationWithoutDefaultArg(id: $id)
            }
          `,
        )
      }).toThrow()
    })

    it('should validate path arguments', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation mutateSomething($id: String) @OAOperation(path: "/mutate/{id}") {
              mutationWithoutDefaultArg(id: $id)
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Variable "$id" of type "String" must be defined as "String!", as it is used within "/mutate/{id}". Source: unknown`,
      )
    })

    it('should fail on overlapping definitions', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation mutateSomething($id: String!) @OAOperation(path: "/mutate/{id}") {
              mutationWithoutDefaultArg(id: $id)
            }

            mutation mutateSomethingElse($firstId: String!)
            @OAOperation(path: "/mutate/{firstId}") {
              mutationWithoutDefaultArg(id: $firstId)
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): "@OAOperation" POST /mutate/{parameter} has already been defined". Source: unknown`,
      )
    })

    it('should fail on unused variables', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation mutateSomething($id: String!) @OAOperation(path: "/mutate/{id}") {
              mutationWithoutDefaultArg(id: $incorrect)
            }
          `,
        ),
      ).toThrow()
    })

    it('should validate unmapped attributes', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation mutateSomething($this: String) @OAOperation(path: "/mutate/{id}") {
              mutationWithoutDefaultArg(id: $this)
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Not all path variables in "/mutate/{id}" are mapped to variables - Missing mappings are: "id". Source: unknown`,
      )
    })

    it('should allow multiple @OABody directives', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation myMutation(
              $inputFirst: SampleInput! @OABody
              $inputSecond: SampleInput! @OABody
            ) @OAOperation(path: "/myMutation") {
              createSampleOne: createSample(input: $inputFirst) {
                id
              }
              createSampleTwo: createSample(input: $inputSecond) {
                id
              }
            }
          `,
        ),
      ).not.toThrow()
    })

    it('should deny multiple @OABody directives with the same paths', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation myMutation(
              $inputFirst: SampleInput! @OABody(path: "test")
              $inputSecond: SampleInput! @OABody(path: "xyz")
              $inputThird: SampleInput! @OABody(path: "xyz")
            ) @OAOperation(path: "/myMutation") {
              createSampleOne: createSample(input: $inputFirst) {
                id
              }
              createSampleTwo: createSample(input: $inputSecond) {
                id
              }
              createSampleThree: createSample(input: $inputThird) {
                id
              }
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Only unique "@OABody(path:...)" definitions allowed. Source: unknown`,
      )
    })
    it('should deny multiple @OABody directives with different contentTypes', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation myMutation(
              $inputFirst: SampleInput! @OABody(contentType: JSON)
              $inputSecond: SampleInput! @OABody(contentType: MULTIPART_FORM_DATA)
            ) @OAOperation(path: "/myMutation") {
              createSampleOne: createSample(input: $inputFirst) {
                id
              }
              createSampleTwo: createSample(input: $inputSecond) {
                id
              }
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Cannot mix different contentType(s) with "@OABody" (found: JSON, MULTIPART_FORM_DATA). Source: unknown`,
      )
    })
    it('should fail in case a `path` parameter is used with @OABody', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            query myQuery($id: Int! @OABody) @OAOperation(path: "/my-query/{id}") {
              getSample(id: $id) {
                id
              }
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Variable "$id" of type "Int!" cannot be used with "@OABody", as it is used within "/my-query/{id}". Source: unknown`,
      )
    })
    it('should fail in case a `path` parameter is not specified in the path', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            query myQuery($id: Int! @OAParam(in: PATH)) @OAOperation(path: "/my-query") {
              getSample(id: $id) {
                id
              }
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Location "path" is invalid for "$id" of type "Int!", because "id" was expected in "/my-query". Source: unknown`,
      )
    })
    it('should fail in case a renamed `path` parameter is not specified in the path', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            query myQuery($id: Int! @OAParam(in: PATH, name: "test"))
            @OAOperation(path: "/my-query/{id}") {
              getSample(id: $id) {
                id
              }
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Not all path variables in "/my-query/{id}" are mapped to variables - Missing mappings are: "id". Source: unknown`,
      )
    })
    it('should fail in case a path parameter is used within another parameter type', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            query myQuery($id: Int! @OAParam(in: QUERY)) @OAOperation(path: "/my-query/{id}") {
              getSample(id: $id) {
                id
              }
            }
          `,
        ),
      ).toThrow(
        `Schema validation error(s): Location "query" is invalid for "$id" of type "Int!", because "id" is part of the path "/my-query/{id}". Source: unknown`,
      )
    })
  })

  describe('should create schema from graphql api', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: bridgeFixtures,
      graphqlSchema,
    })

    const schema = bridge.getOpenAPISchema({
      baseSchema,
    })

    it('should include custom properties by default', () => {
      expect(schema).toMatchSnapshot()
    })

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
    it('should throw when invalid', () => {
      expect(() => {
        const bridge = createOpenAPIGraphQLBridge({
          graphqlDocument: bridgeFixtures,
          graphqlSchema,
          transform: removeCustomProperties,
        })
        bridge.getOpenAPISchema({
          baseSchema: {},
          validate: true,
        })
      }).toThrow()
    })
  })
})
