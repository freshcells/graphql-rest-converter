import { gql } from 'graphql-tag'
import { createOpenAPIGraphQLBridge } from '../express.js'
import { Scalars, customScalarSchema as graphqlSchema } from './fixtures.js'

describe('Scalars', () => {
  it('should throw if a scalar is not defined', () => {
    expect(() =>
      createOpenAPIGraphQLBridge({
        graphqlSchema,
        graphqlDocument: gql`
          query getData @OAOperation(path: "/data") {
            getData {
              id
              created
              data
              modified
            }
          }
        `,
      }),
    ).toThrow(/Unknown custom scalar/)
  })
  it('should throw if a the `customScalars` methods returns undefined', () => {
    expect(() =>
      createOpenAPIGraphQLBridge({
        graphqlSchema,
        graphqlDocument: gql`
          query getData @OAOperation(path: "/data") {
            getData {
              id
              created
              data
              modified
            }
          }
        `,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore this is expected
        customScalars: () => undefined,
      }),
    ).toThrow(
      `Expected a valid schema for scalar "Date", but got undefined. Check your scalar provider function.`,
    )
  })
  it('should allow custom scalars', async () => {
    const result = createOpenAPIGraphQLBridge({
      graphqlSchema,
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
      customScalars: (name: string) => Scalars[name],
    })
    const schema = result.getOpenAPISchema({
      baseSchema: {
        openapi: '3.0.3',
        info: {
          title: 'Sample API',
          version: '1.0.0',
          description: 'My API',
        },
      },
      validate: true,
    })
    expect(schema).toMatchSnapshot()
  })
})
