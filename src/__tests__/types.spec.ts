import { expect } from '@jest/globals'
import { buildSchema, getOperationAST, parse } from 'graphql'
import { GraphQLTypeToOpenAPITypeSchemaConverter } from '../typeConverter.js'

const SCHEMA = /* GraphQL */ `
  interface I {
    i1: String!
  }

  type B implements I {
    b1: Int!
    b2: String!
    i1: String!
  }

  type A1 {
    a1: Int!
    a2: String
    b: B!
  }

  type A2 implements I {
    a1: Int!
    a2: Boolean!
    i1: String!
  }

  union A = A1 | A2

  type Query {
    a: A!
    b: B!
    i: I!
  }
`

const OPERATIONS = /* GraphQL */ `
  query getA($foo: Boolean!) {
    a {
      __typename
      ... on A1 {
        ... @include(if: $foo) {
          a1
        }
        ... on A1 {
          a2
        }
      }
      ... {
        ... on A2 {
          i1
        }
      }
    }
  }

  query getB($foo: Boolean!) {
    b {
      ... on B {
        b1
      }
      ... on B @include(if: $foo) {
        b2
      }
    }
  }
`

const EXPECTATIONS = {
  getA: {
    variables: {
      foo: {
        type: 'boolean',
      },
    },
    result: {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            __typename: {
              $ref: '#/components/schemas/A.__typename',
            },
            a1: {
              type: 'integer',
              format: 'int32',
            },
            a2: {
              type: 'string',
              nullable: true,
            },
            i1: {
              type: 'string',
            },
          },
          required: ['__typename'],
        },
      },
      required: ['a'],
    },
    schemaComponents: {
      'A.__typename': {
        enum: ['A1', 'A2'],
        type: 'string',
      },
    },
  },
}

describe('graphql', () => {
  it('should convert types', () => {
    const dummySchema = buildSchema(SCHEMA)
    const dummyDocument = parse(OPERATIONS)
    const converter = new GraphQLTypeToOpenAPITypeSchemaConverter(dummySchema)

    for (const [operationId, expectation] of Object.entries(EXPECTATIONS)) {
      converter.resetSchemaComponents()
      expect(converter.fromOperation(getOperationAST(dummyDocument, operationId)!)).toEqual({
        name: operationId,
        ...expectation,
      })
    }
  })
})
