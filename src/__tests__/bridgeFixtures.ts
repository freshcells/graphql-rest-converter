import { gql } from 'graphql-tag'
import { buildASTSchema } from 'graphql/index'
import schema from './schema/schema.graphql'
import { addMocksToSchema } from '@graphql-tools/mock'
import { createOpenAPIGraphQLBridge } from '../bridge'
import { makeExecutableSchema } from '@graphql-tools/schema'

export const bridgeFixtures = gql`
  # This will define our OpenAPI Schema

  mutation createSample($sample: SampleInput! @OABody(description: "A Sample Input"))
  @OAOperation(path: "/sample", method: POST, tags: ["Sample"], summary: "Creates a new sample") {
    createSample(input: $sample) {
      id
      name
    }
  }

  mutation updateSample($id: Int! @OAParam(in: PATH), $sample: SampleInput! @OABody)
  @OAOperation(path: "/sample/{id}", method: PUT, tags: ["Sample"], summary: "Updates a sample") {
    updateSample(id: $id, input: $sample) {
      name
    }
  }

  mutation removeSample($id: Int! @OAParam(in: QUERY))
  @OAOperation(path: "/sample", method: DELETE, tags: ["Sample"], summary: "Updates a sample") {
    deleteSample(id: $id)
  }

  fragment MySamples on Sample
  @OADescription(description: "Description for my MySamples fragment") {
    myId: id @OADescription(description: "my custom description on a field")
    myName: name
  }

  query getSamples @OAOperation(path: "/samples", description: "Get all samples") {
    samples: getSamples {
      ...MySamples
    }
  }

  query getSample($id: Int! @OAParam(in: PATH))
  @OAOperation(path: "/sample/{id}", description: "Get a specific sample") {
    getSample(id: $id) {
      ...MySamples
    }
  }
`

export const graphqlSchema = buildASTSchema(schema)

export const gqlSchema = addMocksToSchema({
  schema: makeExecutableSchema({ typeDefs: graphqlSchema }),
})

export const bridge = createOpenAPIGraphQLBridge({
  graphqlDocument: bridgeFixtures,
  graphqlSchema,
})
