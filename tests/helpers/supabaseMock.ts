// Helper para simular la cadena fluida de supabase-js (.from().select()...
// .single()/.maybeSingle(), o await directo del query builder) sin
// depender de Supabase real. No es un archivo de test (no matchea
// tests/**/*.test.ts), solo lo importan los tests unitarios.

export interface ChainResult {
  data: unknown;
  error: unknown;
}

export interface SupabaseChainMock {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  eq: jest.Mock;
  order: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: (
    resolve: (value: ChainResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

export function createChain(result: ChainResult): SupabaseChainMock {
  const chain = {} as SupabaseChainMock;

  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(result);
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);

  return chain;
}

// `results` se consumen en el mismo orden en que el service llama a
// `.from(...)`, sin importar la tabla — hay que configurarlos en el orden
// exacto de las queries que hace el método bajo prueba.
export function createSupabaseFromMock(results: ChainResult[]): jest.Mock {
  const from = jest.fn();
  results.forEach((result) => {
    from.mockReturnValueOnce(createChain(result));
  });
  return from;
}
