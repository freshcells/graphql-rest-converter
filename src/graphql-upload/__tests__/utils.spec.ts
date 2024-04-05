import { parse } from 'graphql'
import { getAllVariablesFromDocuments } from '../utils.js'

test('getAllVariablesFromDocuments', () => {
  const document1 = parse(`
    mutation upload($var1: Upload, $var2: Upload!, $var3: Upload) {
      upload(var1: $var1, var2: $var2, var3: $var3)
    }
  `)

  const result = getAllVariablesFromDocuments([document1, document1])

  expect(result).toMatchSnapshot()
})
