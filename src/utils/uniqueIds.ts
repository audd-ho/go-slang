import * as es from 'estree'

import { NativeStorage } from '../types'
import * as create from '../utils/ast/astCreator'
import { simple } from '../utils/walkers'

const globalIdNames = [
  'native',
  'callIfFuncAndRightArgs',
  'boolOrErr',
  'wrap',
  'unaryOp',
  'binaryOp',
  'throwIfTimeout',
  'setProp',
  'getProp',
  'builtins'
] as const

export type NativeIds = Record<(typeof globalIdNames)[number], es.Identifier>

export function getNativeIds(program: es.Program, usedIdentifiers: Set<string>): NativeIds {
  const globalIds = {}
  for (const identifier of globalIdNames) {
    (globalIds as any)[identifier] = create.identifier(getUniqueId(usedIdentifiers, identifier))
  }
  return globalIds as NativeIds
}

export function getUniqueId(usedIdentifiers: Set<string>, uniqueId = 'unique') {
  while (usedIdentifiers.has(uniqueId)) {
    const start = uniqueId.slice(0, -1)
    const end = uniqueId[uniqueId.length - 1]
    const endToDigit = Number(end)
    if (Number.isNaN(endToDigit) || endToDigit === 9) {
      uniqueId += '0'
    } else {
      uniqueId = start + String(endToDigit + 1)
    }
  }
  usedIdentifiers.add(uniqueId)
  return uniqueId
}

export function getIdentifiersInNativeStorage(nativeStorage: NativeStorage) {
  const used = new Set(...nativeStorage.builtins.keys())
  nativeStorage.previousProgramsIdentifiers.forEach(id => used.add(id))
  return used
}

export function getIdentifiersInProgram(program: es.Program) {
  const identifiers = new Set<string>()
  simple(program, {
    Identifier(node: es.Identifier) {
      identifiers.add(node.name)
    },
    Pattern(node: es.Pattern) {
      if (node.type === 'Identifier') {
        identifiers.add(node.name)
      } else if (node.type === 'MemberExpression') {
        if (node.object.type === 'Identifier') {
          identifiers.add(node.object.name)
        }
      }
    }
  })
  return identifiers
}

export function getFunctionDeclarationNamesInProgram(program: es.Program): Set<string> {
  const functionNames = new Set<string>()

  simple(program, {
    FunctionDeclaration(node: es.FunctionDeclaration) {
      if (node.id && node.id.type === 'Identifier') {
        functionNames.add(node.id.name)
      }
    }
  })

  return functionNames
}
