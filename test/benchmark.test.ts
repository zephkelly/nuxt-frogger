import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import { performance } from 'perf_hooks'
import { rmSync, mkdirSync, existsSync } from 'node:fs'
import { ServerFroggerLogger } from './../src/runtime/server/utils/server-logger'
import { FileReporter } from './../src/runtime/server/utils/reporters/file-reporter'
import type { LoggerObject } from '../src/runtime/shared/types/log'
import type { ServerLoggerOptions } from '../src/runtime/server/types/logger'

// Mock useRuntimeConfig for testing
const mockConfig = {
  // Public runtime config (accessed by client and server)
  public: {
    frogger: {
      endpoint: '/api/_frogger/logs',
      batch: {
        maxSize: 50,
        maxAge: 3000,
        retryOnFailure: true,
        maxRetries: 3,
        retryDelay: 3000,
        sortingWindowMs: 1000,
      }
    }
  },
  // Private runtime config (server-only)
  frogger: {
    file: {
      directory: './test-logs',
      fileNameFormat: 'YYYY-MM-DD.log',
      maxSize: 10 * 1024 * 1024,
      flushInterval: 1000,
      bufferMaxSize: 1 * 1024 * 1024,
      highWaterMark: 64 * 1024,
    },
    batch: {
      maxSize: 200,
      maxAge: 15000,
      retryOnFailure: true,
      maxRetries: 5,
      retryDelay: 10000,
      sortingWindowMs: 3000,
    }
  }
}

vi.mock('#imports', () => ({
  useRuntimeConfig: () => mockConfig
}))

// Global test configuration constants
const GLOBAL_ITERATIONS = 10000        // Default iterations for most tests
const HIGH_THROUGHPUT_ITERATIONS = 25000   // For high-throughput tests
const COMPLEX_ITERATIONS = 5000            // For complex object tests
const WARMUP_ITERATIONS = 100              // Warmup iterations
const MAX_TEST_TIMEOUT = 30000             // 30 seconds max timeout for any test

interface BenchmarkResult {
  name: string
  totalTime: number
  loggerTime: number
  fileWriteTime: number
  opsPerSec: number
}

class FroggerPipelineBenchmark {
  private results: BenchmarkResult[] = []
  
  async benchmark(
    name: string, 
    setupFn: () => { logger: ServerFroggerLogger; fileReporter: FileReporter },
    logCall: (logger: ServerFroggerLogger) => void,
    iterations: number = 10000
  ): Promise<BenchmarkResult> {
    
    const times = {
      total: [] as number[],
      logger: [] as number[],
      fileWrite: [] as number[]
    }
    
    // Warm up - using global constant
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const { logger, fileReporter } = setupFn()
      
      let warmupCaptured: LoggerObject | null = null
      logger.setTestCaptureCallback((loggerObject) => {
        warmupCaptured = loggerObject
      })
      
      logCall(logger)
      await fileReporter.forceFlush()
      logger.clearTestCaptureCallback()
    }
    
    // Actual benchmark
    for (let i = 0; i < iterations; i++) {
      const { logger, fileReporter } = setupFn()
      
      // Capture the LoggerObject that gets created
      let capturedLoggerObject: LoggerObject | null = null
      
      // Set up the capture callback
      logger.setTestCaptureCallback((loggerObject) => {
        capturedLoggerObject = loggerObject
      })
      
      // Time the logger call (info/error/etc)
      const loggerStart = performance.now()
      logCall(logger)
      const loggerEnd = performance.now()
      
      // Clear the callback
      logger.clearTestCaptureCallback()
      
      if (!capturedLoggerObject) {
        throw new Error('Failed to capture LoggerObject')
      }
      
      // Time the file write
      const fileStart = performance.now()
      await fileReporter.log(capturedLoggerObject)
      const fileEnd = performance.now()
      
      const totalTime = fileEnd - loggerStart
      const loggerTime = loggerEnd - loggerStart
      const fileWriteTime = fileEnd - fileStart
      
      times.total.push(totalTime)
      times.logger.push(loggerTime)
      times.fileWrite.push(fileWriteTime)
      
      await fileReporter.forceFlush()
    }
    
    const avgTotal = times.total.reduce((a, b) => a + b, 0) / times.total.length
    const avgLogger = times.logger.reduce((a, b) => a + b, 0) / times.logger.length
    const avgFileWrite = times.fileWrite.reduce((a, b) => a + b, 0) / times.fileWrite.length
    const opsPerSec = Math.round(1000 / avgTotal)
    
    const result: BenchmarkResult = {
      name,
      totalTime: avgTotal,
      loggerTime: avgLogger,
      fileWriteTime: avgFileWrite,
      opsPerSec
    }
    
    this.results.push(result)
    
    console.log(`✅ ${name} (${iterations.toLocaleString()} iterations):`)
    console.log(`   📊 TIMING BREAKDOWN (per single operation):`)
    console.log(`   ├─ Logger Processing: ${avgLogger.toFixed(4)}ms (object creation + validation)`)
    console.log(`   ├─ File Writing: ${avgFileWrite.toFixed(4)}ms (disk I/O operation)`)
    console.log(`   └─ Total Pipeline: ${avgTotal.toFixed(4)}ms (end-to-end latency)`)
    console.log(`   🚀 PERFORMANCE METRICS:`)
    console.log(`   ├─ Throughput: ${opsPerSec.toLocaleString()} operations/second`)
    console.log(`   ├─ Total Test Duration: ${(avgTotal * iterations).toFixed(2)}ms`)
    console.log(`   └─ Logger vs File Ratio: ${(avgLogger / avgFileWrite).toFixed(2)}:1`)
    console.log('')
    
    return result
  }
  
  printSummary() {
    if (this.results.length === 0) return
    
    console.log('\n📊 FROGGER PIPELINE BENCHMARK SUMMARY')
    console.log('='.repeat(50))

    const sorted = [...this.results].sort((a, b) => a.totalTime - b.totalTime)
    const fastest = sorted[0]
    
    sorted.forEach(result => {
      const isFastest = result.name === fastest.name
      const slowdownFactor = result.totalTime / fastest.totalTime
      const marker = isFastest ? '🏆' : '  '
      
      console.log(`${marker} ${result.name}:`)
      console.log(`   Total Pipeline: ${result.totalTime.toFixed(4)}ms per operation`)
      console.log(`   ├─ Logger Processing: ${result.loggerTime.toFixed(4)}ms (${((result.loggerTime / result.totalTime) * 100).toFixed(1)}%)`)
      console.log(`   └─ File Writing: ${result.fileWriteTime.toFixed(4)}ms (${((result.fileWriteTime / result.totalTime) * 100).toFixed(1)}%)`)
      console.log(`   Throughput: ${result.opsPerSec.toLocaleString()} operations/second`)
      if (!isFastest) {
        console.log(`   Performance: ${slowdownFactor.toFixed(2)}x slower than fastest`)
      } else {
        console.log(`   Performance: 🏆 FASTEST`)
      }
      console.log('')
    })
  }
  
  clear() {
    this.results = []
  }
}

describe('Frogger Complete Pipeline Benchmarks', () => {
  let benchmarkSuite: FroggerPipelineBenchmark
  const testLogDir = './test-logs'
  
  beforeEach(async () => {
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true })
    }
    mkdirSync(testLogDir, { recursive: true })
    
    benchmarkSuite = new FroggerPipelineBenchmark()
  })
  
  afterEach(async () => {
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true })
    }
  })

  it('should benchmark string logging pipeline', async () => {
    await benchmarkSuite.benchmark(
      'String Log Pipeline',
      () => {
        const options: ServerLoggerOptions = { level: 3, consoleOutput: false }
        const logger = new ServerFroggerLogger(options)
        const fileReporter = new FileReporter()
        return { logger, fileReporter }
      },
      (logger) => logger.info('hello world'),
      10000 // Increased from 5000
    )
    
    benchmarkSuite.printSummary()
  }, 10000) // Add timeout
  
  it('should benchmark object logging pipeline', async () => {
    benchmarkSuite.clear()
    
    await benchmarkSuite.benchmark(
      'Object Log Pipeline',
      () => {
        const options: ServerLoggerOptions = { level: 3, consoleOutput: false }
        const logger = new ServerFroggerLogger(options)
        const fileReporter = new FileReporter()
        return { logger, fileReporter }
      },
      (logger) => logger.info('user action', { userId: 12345, action: 'login' }),
      10000 // Increased from 5000
    )
    
    benchmarkSuite.printSummary()
  }, 10000) // Add timeout
  
  it('should benchmark error logging pipeline', async () => {
    benchmarkSuite.clear()
    
    await benchmarkSuite.benchmark(
      'Error Log Pipeline',
      () => {
        const options: ServerLoggerOptions = { level: 3, consoleOutput: false }
        const logger = new ServerFroggerLogger(options)
        const fileReporter = new FileReporter()
        return { logger, fileReporter }
      },
      (logger) => logger.error('database error', {
        error: new Error('Connection failed'),
        query: 'SELECT * FROM users',
        timestamp: Date.now()
      }),
      GLOBAL_ITERATIONS
    )
    
    benchmarkSuite.printSummary()
  }, MAX_TEST_TIMEOUT)
  
  it('should benchmark complex object logging pipeline', async () => {
    benchmarkSuite.clear()
    
    const complexContext = {
      user: {
        id: 'user_123',
        email: 'test@example.com',
        roles: ['admin', 'user']
      },
      request: {
        method: 'POST',
        url: '/api/users',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        body: {
          name: 'John Doe',
          preferences: {
            theme: 'dark',
            notifications: true,
            features: ['feature1', 'feature2']
          }
        }
      },
      metadata: {
        sessionId: 'sess_abc123',
        correlationId: 'corr_def456',
        environment: 'production'
      }
    }
    
    await benchmarkSuite.benchmark(
      'Complex Object Pipeline',
      () => {
        const options: ServerLoggerOptions = { level: 3, consoleOutput: false }
        const logger = new ServerFroggerLogger(options)
        const fileReporter = new FileReporter()
        return { logger, fileReporter }
      },
      (logger) => logger.info('complex operation completed', complexContext),
      COMPLEX_ITERATIONS
    )
    
    benchmarkSuite.printSummary()
  }, MAX_TEST_TIMEOUT)
})

// Additional utility for exposing createLoggerObject for testing
export class FroggerTestUtils {
  /**
   * Create a test logger that exposes internal methods for benchmarking
   */
  static createTestLogger(options: ServerLoggerOptions = { level: 3, consoleOutput: false }) {
    const logger = new ServerFroggerLogger(options)
    
    return {
      logger,
      
      // Expose the createLoggerObject method for direct testing
      createLoggerObject: (message: string, context?: Object, level: string = 'info') => {
        return logger.createLoggerObjectForTest(message, context, level)
      },
      
      // Direct method to test just the LoggerObject creation
      benchmarkLoggerObjectCreation: async (iterations: number = HIGH_THROUGHPUT_ITERATIONS) => {
        const times: number[] = []
        
        console.log(`🔄 Running LoggerObject creation benchmark (${iterations.toLocaleString()} iterations)...`)
        
        for (let i = 0; i < iterations; i++) {
          const start = performance.now()
          const loggerObject = logger.createLoggerObjectForTest('test message', { iteration: i })
          const end = performance.now()
          times.push(end - start)
        }
        
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length
        const minTime = Math.min(...times)
        const maxTime = Math.max(...times)
        const opsPerSec = Math.round(1000 / avgTime)
        
        console.log(`📊 LoggerObject Creation Benchmark Results:`)
        console.log(`   📈 TIMING BREAKDOWN:`)
        console.log(`   ├─ Average: ${avgTime.toFixed(4)}ms per operation`)
        console.log(`   ├─ Minimum: ${minTime.toFixed(4)}ms (fastest single operation)`)
        console.log(`   └─ Maximum: ${maxTime.toFixed(4)}ms (slowest single operation)`)
        console.log(`   🚀 PERFORMANCE METRICS:`)
        console.log(`   ├─ Total Test Duration: ${(avgTime * iterations).toFixed(2)}ms`)
        console.log(`   ├─ Throughput: ${opsPerSec.toLocaleString()} operations/second`)
        console.log(`   └─ Peak Theoretical: ${Math.round(1000 / minTime).toLocaleString()} ops/sec`)
        
        return { avgTime, opsPerSec, minTime, maxTime }
      }
    }
  }
}

// Standalone benchmark runner
export async function runFroggerBenchmarks() {
  console.log('🐸 FROGGER COMPLETE PIPELINE BENCHMARKS')
  console.log('='.repeat(50))

  const suite = new FroggerPipelineBenchmark()
  
  // Setup
  const testLogDir = './benchmark-logs'
  if (existsSync(testLogDir)) {
    rmSync(testLogDir, { recursive: true, force: true })
  }
  mkdirSync(testLogDir, { recursive: true })
  
  try {
    const createSetup = () => {
      const options: ServerLoggerOptions = { level: 3, consoleOutput: false }
      const logger = new ServerFroggerLogger(options)
      const fileReporter = new FileReporter()
      return { logger, fileReporter }
    }
    
    // Run comprehensive benchmarks with higher iterations
    await suite.benchmark(
      'String Pipeline',
      createSetup,
      (logger) => logger.info('hello world'),
      25000 // Increased from 10000
    )
    
    await suite.benchmark(
      'Object Pipeline',
      createSetup,
      (logger) => logger.info('user action', { userId: 12345, action: 'login' }),
      20000 // Increased from 10000
    )
    
    await suite.benchmark(
      'Error Pipeline',
      createSetup,
      (logger) => logger.error('error occurred', { 
        error: 'Database connection failed',
        code: 'DB_ERROR',
        timestamp: Date.now()
      }),
      15000 // Increased from 10000
    )
    
    await suite.benchmark(
      'Complex Object Pipeline',
      createSetup,
      (logger) => logger.info('complex operation', {
        user: { id: 'user_123', roles: ['admin'] },
        request: { method: 'POST', url: '/api/users' },
        metadata: { sessionId: 'sess_abc', env: 'prod' }
      }),
      12000
    )
    
    await suite.benchmark(
      'High-Frequency Logging',
      createSetup,
      (logger) => logger.info('tick', { timestamp: Date.now(), counter: Math.random() }),
      30000
    )
    
    suite.printSummary()
    
    // Test LoggerObject creation separately with higher iterations
    console.log('\n🔧 INTERNAL COMPONENT BENCHMARKS')
    console.log('='.repeat(40))
    
    const testUtils = FroggerTestUtils.createTestLogger()
    await testUtils.benchmarkLoggerObjectCreation(100000) // Increased from 50000
    
  } finally {
    // Cleanup
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true })
    }
  }
}