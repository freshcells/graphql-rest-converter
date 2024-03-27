import { OpenAPIV3 } from 'openapi-types'

export const UploadScalars: Record<string, OpenAPIV3.SchemaObject> = {
  Upload: {
    type: 'string',
    format: 'binary',
  },
  Uploads: {
    type: 'array',
    items: {
      type: 'string',
      format: 'binary',
    },
  },
}
