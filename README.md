## graphql-rest-converter

[![Test](https://github.com/freshcells/graphql-rest-converter/actions/workflows/test.yaml/badge.svg)](https://github.com/freshcells/graphql-rest-converter/actions/workflows/test.yaml)
[![codecov](https://codecov.io/gh/freshcells/graphql-rest-converter/branch/main/graph/badge.svg?token=C18QYCC7OA)](https://codecov.io/gh/freshcells/graphql-rest-converter)
[![npm](https://img.shields.io/npm/v/@freshcells/graphql-rest-converter)](https://www.npmjs.com/package/@freshcells/graphql-rest-converter)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Purpose

The package creates an HTTP API and a corresponding OpenAPI schema based on annotated GraphQL operations.

## Features

- Automatically generated request handlers
- Automatically generated OpenAPI schema
- Arbitrary GraphQL queries supported
- Accurate OpenAPI type schemas for response and parameters derived from GraphQL schema
- Support OpenAPI 3.0 for maximum compatibility with the OpenAPI ecosystem
- Supports `application/x-www-form-urlencoded` requests
- Supports `multipart/form-data` requests with file uploads as specified in
  the [graphql-multipart-request-spec](https://github.com/jaydenseric/graphql-multipart-request-spec) specification.

## Installation

With `npm`:

    npm install @freshcells/graphql-rest-converter

With `yarn`:

    yarn add @freshcells/graphql-rest-converter

## [API documentation](https://freshcells.github.io/graphql-rest-converter/)

## Supported OpenAPI versions

The package generates an OpenAPI schema for version 3.0 of the specification.

## How to use

### General work flow

To define a HTTP API request:

1. Define a GraphQL operation to get the data from your GraphQL API
2. Use directives on the operation to define URL path, parameter mapping, additional OpenAPI documentation, etc.
3. The package will generate a request handler and an OpenAPI schema for the request

### Entry point

The entry point is
the [`createOpenAPIGraphQLBridge`](https://freshcells.github.io/graphql-rest-converter/modules.html#createOpenAPIGraphQLBridge)
function.

The function takes a config with:

- The GraphQL document containing the operations with directives to define the HTTP API requests
- The GraphQL schema of the target GraphQL API
- A function to map custom scalars used in the target GraphQL API to OpenAPI type schemas (optional)

The function returns an object with two functions:

- The
  function [`getExpressMiddleware`](https://freshcells.github.io/graphql-rest-converter/modules.html#createOpenAPIGraphQLBridge)
  is used to get the request handlers for the HTTP API as an `express` middleware
- The
  function [`getOpenAPISchema`](https://freshcells.github.io/graphql-rest-converter/modules.html#createOpenAPIGraphQLBridge)
  is used to the get the OpenAPI schema for the HTTP API

### Annotating GraphQL operations

#### `OAOperation`

The `OAOperation` GraphQL directive is required on an GraphQL operation to map it to an HTTP request.

The arguments of the directive are described by the TS type:

```typescript
interface OAOperation {
  path: string
  tags?: [string]
  summary?: string
  description?: string
  externalDocs?: {
    url: string
    description?: string
  }
  deprecated: boolean
  method: HttpMethod // GET, DELETE, POST, PUT
}
```

The `path` argument is required and defines the URL path of the resulting request.
Path parameters can be defined with OpenAPI syntax, for example: `/my/api/user/{id}`.

The other arguments are mapped directly to the resulting OpenAPI schema for the request.

#### `OAParam`

The `OAParam` is optional, every operation's variable declaration results in an API parameter.

If the path defined in the operation's `OAOperation` directive contains a parameter matching the variable name, the
variable will be mapped from the path parameter.
Otherwise, the variable will be mapped from a `query` or `header` parameter.

The arguments of the directive are described by the TS type:

```typescript
interface OAParam {
  in?: 'path' | 'query' | 'header'
  name?: string
  description?: string
  deprecated?: boolean
}
```

The `in` argument can be used to change the type of parameter.
It is useful, for example, if a variable should be mapped from a `header` instead of a `query` parameter.

The `name` argument can be used to explicitly define the parameter name. If it is not provided it uses the variable
name.
It is useful, for example, if the desired parameter name is not a valid GraphQL variable name.

The other arguments are mapped directly to the resulting OpenAPI schema for the parameter.

#### `OABody`

Lets you mark a query argument to be extracted from the request `body`.
Mainly designed for `input` types in combination with a `mutation`.

```typescript
interface OABody {
  description?: string
  path?: string
  contentType?: 'JSON' | 'FORM_DATA' | 'MULTIPART_FORM_DATA'
}
```

You can have multiple arguments annotated with `OABody`, the variable name (or the `path` overwrite) will then be
expected as `key` in the request
body. If you annotate only a single `InputType`, which is an object, there is no additional hierarchy introduced,
the `InputType` object is expected in the root.

#### `OADescription`

You may optionally provide / override descriptions for `fragment` and `field` definitions.

```typescript
interface OADescription {
  description: string
}
```

### Generating the request handlers

To generate the request handlers the
function [`getExpressMiddleware`](https://freshcells.github.io/graphql-rest-converter/modules.html#createOpenAPIGraphQLBridge)
is used.

As the first argument it takes a `GraphQLExecutor` implementation:

- The package already provides two implementations:
  - [`createHTTPExecutor`](https://freshcells.github.io/graphql-rest-converter/modules.html#createHttpExecutor)
    - Takes the same arguments [`GraphQLClient`](https://github.com/prisma-labs/graphql-request#usage) from
      the `graphql-request` package (mainly a URL)
    - Creates an executor that resolves GraphQL operations via HTTP
  - [`createSchemaExecutor`](https://freshcells.github.io/graphql-rest-converter/modules.html#createSchemaExecutor)
    - Takes a [`GraphQLSchema`](https://graphql.org/graphql-js/type/#graphqlschema) from the `graphql` package as
      argument
    - Creates an executor that resolves GraphQL operations via the provided in-process GraphQL schema
- Custom implementations can be created

As a second optional argument it takes a configuration object with the properties:

- `responseTransformer`
  - See [Configuration option `responseTransformer`](#configuration-option-responsetransformer)
- `validateRequest`
  - Validate HTTP requests against the generated OpenAPI schema
  - Defaults to `true`
- `validateResponse`
  - Validate HTTP responses against generated OpenAPI schema
  - Defaults to `false`

#### Configuration option `responseTransformer`

Sometimes it may be necessary to adjust the HTTP response to achieve some required API behavior.

For example:

- The structure of a GraphQL operation may need to be customized
- Some values within a GraphQL operation result may need to be mapped or differently encoded
- Some GraphQL operation results should be mapped to HTTP error codes
- Another encoding for the response body than JSON is required

In general, when making use of this feature the OpenAPI schema needs to be adjusted accordingly.

If a response is transformed it will not be validated even if `validateResponse` is configured.

If used, a function should be provided. See the API documentation for the type of the
function: https://freshcells.github.io/graphql-rest-converter/modules.html#ResponseTransformer.

It will be called for every request to the HTTP API with:

- The OpenAPI schema details of the request
- The GraphQL request details
- The GraphQL response details

It should return:

- `undefined` if the response should not be customized
- HTTP response details in case the response should be customized

### Generating the OpenAPI schema

To generate the OpenAPI schema the
function [`getOpenAPISchema`](https://freshcells.github.io/graphql-rest-converter/modules.html#createOpenAPIGraphQLBridge)
is used.

As an argument it takes a configuration object with the properties:

- `baseSchema`
  - As a convenience, this object will be recursively merged into the generated OpenAPI schema
- `validate`
  - Validates that the returned OpenAPI schema is valid according to the OpenAPI specification
  - Defaults to `false`

### Custom OpenAPI properties

The generated OpenAPI schema contains the customer properties `x-graphql-operation` and `x-graphql-variable-name`.

These custom properties contain all necessary information to generate the request handlers.

To remove the custom properties from the OpenAPI schema, for example before serving it publicly, the
transformation
function [`removeCustomProperties`](https://freshcells.github.io/graphql-rest-converter/functions/removeCustomProperties.html)
can be used.

## Usage example

This example showcases most of the usage discussed so far.
The hypothetical Star Wars GraphQL schema is inspired by the official GraphQL introduction: https://graphql.org/learn/.

```ts
import express from 'express'
import fetch from 'node-fetch'
import { buildClientSchema, getIntrospectionQuery } from 'graphql'
import { gql } from 'graphql-tag'
import {
  removeCustomProperties,
  transform,
  createHttpExecutor,
} from '@freshcells/graphql-rest-converter'
import {
  createOpenAPIGraphQLBridge,
  createExpressMiddlewareFromOpenAPISchema,
} from '@freshcells/graphql-rest-converter/express'

const GRAPHQL_ENDPOINT = 'https://example.org/graphql'

const BRIDGE_DOCUMENT = gql`
  query getHeroByEpisode(
    $episode: String!
    $includeAppearsIn: Boolean! = false
      @OAParam(
        in: QUERY
        name: "include_appears_in"
        description: "Include all episodes the hero appears in"
        deprecated: false
      )
  )
  @OAOperation(
    path: "/hero/{episode}"
    tags: ["Star Wars", "Hero"]
    summary: "Retrieve heros"
    description: "Retrieve heros by episode, optionally including the episodes they appear in"
    externalDocs: {
      url: "https://www.google.com/search?q=star+wars"
      description: "More information"
    }
    deprecated: false
  ) {
    hero(episode: $episode) {
      name
      appearsIn @include(if: $includeAppearsIn)
    }
  }

  mutation createANewHero($name: String, $hero: HeroInput! @OABody(description: "Our new Hero"))
  @OAOperation(path: "/hero/{name}", tags: ["Star Wars", "Hero"], method: POST) {
    createNewHero(name: $name, input: $hero) {
      name
    }
  }
`

const LOCAL_PORT = '3000'
const API_PATH = '/star-wars'

const BASE_OPENAPI_SCHEMA = {
  openapi: '3.0.3',
  info: {
    title: 'Star Wars API',
    description: '...',
    version: '1.0.0',
  },
  servers: [
    {
      url: API_PATH,
      description: 'Local server',
    },
  ],
}

const getCustomScalars = (scalarTypeName) => {
  return {
    DateTime: {
      type: 'string',
      format: 'date-time',
    },
    JSON: {},
  }[scalarTypeName]
}

async function main() {
  const app = express()

  const graphqlSchema = buildClientSchema(
    (
      await (
        await fetch(GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: getIntrospectionQuery() }),
        })
      ).json()
    ).data
  )

  const openAPIGraphQLBridge = createOpenAPIGraphQLBridge({
    graphqlSchema,
    graphqlDocument: BRIDGE_DOCUMENT,
    customScalars: getCustomScalars,
  })

  const openAPISchema = openAPIGraphQLBridge.getOpenAPISchema({
    baseSchema: BASE_OPENAPI_SCHEMA,
    validate: true, // Default is false
    // `removeCustomProperties` can be omitted if the underlying GraphQL operations should be visible as custom properties
    transform: removeCustomProperties,
    // or multiple transformers:
    // transform: transform(removeCustomProperties, yourOwnTransformer)
  })

  const httpExecutor = createHttpExecutor(GRAPHQL_ENDPOINT)

  const apiMiddleware = openAPIGraphQLBridge.getExpressMiddleware(httpExecutor, {
    validateRequest: true, // Default is true
    validateResponse: true, // Default is false
    // Optional, can be used for customized status codes for example
    responseTransformer: async ({ result, openAPISchema: { operation } }) => {
      if (
        operation?.operationId === 'getHeroByEpisode' &&
        result?.status === 200 &&
        !result?.data?.hero?.length
      ) {
        return {
          statusCode: 404,
          contentType: 'application/json',
          data: JSON.stringify({ error: 'No heros found' }),
        }
      }
    },
  })

  app.use(API_PATH, apiMiddleware)

  app.get('/openapi.json', (req, res) => {
    res.json(openAPISchema)
  })

  app.listen(LOCAL_PORT)
}

main()
```

## Custom server

The library provides out of the box support for `express`. You may provide your own server with

```ts
import { createRequestHandler } from '@freshcells/graphql-rest-converter'

// ...
```

Please consult the [express implementation](./src/express.ts) for an example.

## Upcoming features

- OpenAPI 3.1 support
- Direct support for more HTTP servers than express
- Support for cookie parameters
