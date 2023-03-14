import schema from './schema/schema.graphql'
import { buildASTSchema } from 'graphql'
import { createOpenAPIGraphQLBridge } from '../express'
import { gql } from 'graphql-tag'
import { bridgeFixtures } from './fixtures'
import { getBridgeOperations } from '../graphql'
import { removeCustomProperties } from '../transformers'
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
          `
        )
      }).toThrow(
        'Schema validation error(s): Missing required directive "@OAOperation" on operation "mutateSomething". Source: unknown'
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
          `
        )
      }).toThrow(
        'Schema validation error(s): Directive "@OAOperation" may not be used on SUBSCRIPTION. Source: unknown'
      )
    })

    it('should validate path arguments', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation mutateSomething($id: String @OAParam) @OAOperation(path: "/mutate/{id}") {
              mutationWithoutDefaultArg(id: $id)
            }
          `
        )
      ).toThrow(
        `Schema validation error(s): Variable "$id" of type "String" must be defined as "String!", as it is used in a "PATH" argument.". Source: unknown`
      )
    })

    it('should deny multiple @OABody directives', () => {
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
          `
        )
      ).toThrow(/Only one "OABody" variable allowed/)
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
          `
        )
      ).toThrow(
        `Schema validation error(s): Location "path" is invalid for "$id" of type "Int!", because "id" was expected in "/my-query". Source: unknown`
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
          `
        )
      ).toThrow(
        `Schema validation error(s): Location "path" is invalid for "$id" of type "Int!", because "test" was expected in "/my-query/{id}". Source: unknown`
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
          `
        )
      ).toThrow(
        `Schema validation error(s): Location "query" is invalid for "$id" of type "Int!", because "id" is part of the path "/my-query/{id}". Source: unknown`
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
      const schema = bridge.getOpenAPISchema({
        baseSchema,
        transform: removeCustomProperties,
      })

      expect(schema).toMatchSnapshot()
    })
    it('should throw when invalid', () => {
      expect(() =>
        bridge.getOpenAPISchema({
          baseSchema: {},
          validate: true,
          transform: removeCustomProperties,
        })
      ).toThrow()
    })
  })
})
