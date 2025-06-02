import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { performance } from 'perf_hooks'
import { createWriteStream } from 'node:fs'
import { TestFroggerLogger } from '../src/runtime/shared/utils/test-frogger'
import { spawn } from 'node:child_process'


interface BenchmarkResult {
    iteration: number
    totalTimeMs: number
    opsPerSecond: number
    avgTimePerOpMs: number
}

interface BenchmarkSummary {
    totalIterations: number
    operationsPerIteration: number
    bestResult: BenchmarkResult
    worstResult: BenchmarkResult
    averageTimeMs: number
    averageOpsPerSecond: number
    standardDeviation: number
    optimizationMode: 'optimized' | 'no-opt'
}

interface ComparisonResult {
    optimized: BenchmarkSummary
    noOpt: BenchmarkSummary
    optimizationImpact: {
        speedupFactor: number
        consistencyDifference: number
        recommendation: string
    }
}

class SimpleFroggerBenchmark {
    private readonly OPERATIONS_PER_ITERATION = 10000
    private readonly TOTAL_ITERATIONS = 10
    
    async runBenchmark(optimizationMode: 'optimized' | 'no-opt' = 'optimized'): Promise<BenchmarkSummary> {
        console.log(`🐸 FROGGER BENCHMARK - ${optimizationMode.toUpperCase()} MODE`)
        console.log('='.repeat(50))
        console.log(`📊 Configuration:`)
        console.log(`   ├─ Optimization Mode: ${optimizationMode}`)
        console.log(`   ├─ Operations per iteration: ${this.OPERATIONS_PER_ITERATION.toLocaleString()}`)
        console.log(`   ├─ Total iterations: ${this.TOTAL_ITERATIONS}`)
        console.log(`   └─ Total operations: ${(this.OPERATIONS_PER_ITERATION * this.TOTAL_ITERATIONS).toLocaleString()}`)
        console.log('')
        
        const results: BenchmarkResult[] = []
        
        for (let i = 1; i <= this.TOTAL_ITERATIONS; i++) {
            const result = await this.runSingleIteration(i)
            results.push(result)
        }
        
        const summary = this.calculateSummary(results, optimizationMode)
        this.printSummary(summary)
        
        return summary
    }
    
    async runBenchmarkWithFlags(nodeFlags: string[]): Promise<BenchmarkSummary> {
        return new Promise((resolve, reject) => {
            const isNoOpt = nodeFlags.includes('--no-opt')
            const optimizationMode = isNoOpt ? 'no-opt' : 'optimized'
            
            const benchmarkScript = `
        const { performance } = require('perf_hooks');
        const { createWriteStream } = require('node:fs');
        
        // Mock TestFroggerLogger for this isolated test
        class MockTestFroggerLogger {
          constructor() {}
          info(msg) {
            // Simulate logger work - object creation, serialization
            const logObj = {
              time: Date.now(),
              level: 'info',
              message: msg,
              context: { env: 'test', pid: process.pid }
            };
            const serialized = JSON.stringify(logObj);
            // Simulate stream write
            return serialized.length;
          }
        }
        
        const OPERATIONS = 10000;
        const ITERATIONS = 10;
        const results = [];
        
        console.log('{"type":"start","mode":"${optimizationMode}"}');
        
        for (let iter = 1; iter <= ITERATIONS; iter++) {
          const logger = new MockTestFroggerLogger();
          
          const startTime = performance.now();
          for (let i = 0; i < OPERATIONS; i++) {
            logger.info('Hello world');
          }
          const endTime = performance.now();
          
          const totalTimeMs = endTime - startTime;
          const opsPerSecond = Math.round((OPERATIONS / totalTimeMs) * 1000);
          const avgTimePerOpMs = totalTimeMs / OPERATIONS;
          
          const result = {
            iteration: iter,
            totalTimeMs,
            opsPerSecond,
            avgTimePerOpMs
          };
          
          results.push(result);
          console.log(JSON.stringify({type:"iteration", ...result}));
        }
        
        console.log(JSON.stringify({type:"complete", results}));
      `;
            
            const child = spawn('node', [...nodeFlags, '-e', benchmarkScript], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let output = '';
            let startReceived = false;
            const iterationResults: BenchmarkResult[] = [];
            
            child.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter((line: any) => line.trim());
                
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        
                        if (parsed.type === 'start') {
                            startReceived = true;
                            console.log(`🚀 Starting ${parsed.mode} benchmark...`);
                        } else if (parsed.type === 'iteration') {
                            iterationResults.push({
                                iteration: parsed.iteration,
                                totalTimeMs: parsed.totalTimeMs,
                                opsPerSecond: parsed.opsPerSecond,
                                avgTimePerOpMs: parsed.avgTimePerOpMs
                            });
                        } else if (parsed.type === 'complete') {
                            const summary = this.calculateSummary(iterationResults, optimizationMode);
                            resolve(summary);
                        }
                    } catch (e) {
                    }
                }
            });
            
            child.stderr.on('data', (data) => {
                console.error(`Error: ${data}`);
            });
            
            child.on('close', (code) => {
                if (code !== 0 && !startReceived) {
                    reject(new Error(`Child process exited with code ${code}`));
                }
            });
        });
    }
    
    private async runSingleIteration(iterationNumber: number): Promise<BenchmarkResult> {
        const nullStream = createWriteStream(process.platform === 'win32' ? 'NUL' : '/dev/null')
        const logger = new TestFroggerLogger({ 
            stream: nullStream,
            format: 'json',
            level: 3 
        })
        
        const startTime = performance.now()
        
        for (let i = 0; i < this.OPERATIONS_PER_ITERATION; i++) {
            logger.info('Hello world')
        }
        
        const endTime = performance.now()
        const totalTimeMs = endTime - startTime
        
        const opsPerSecond = Math.round((this.OPERATIONS_PER_ITERATION / totalTimeMs) * 1000)
        const avgTimePerOpMs = totalTimeMs / this.OPERATIONS_PER_ITERATION
        
        nullStream.destroy()
        
        return {
            iteration: iterationNumber,
            totalTimeMs,
            opsPerSecond,
            avgTimePerOpMs
        }
    }
    
    private calculateSummary(results: BenchmarkResult[], optimizationMode: 'optimized' | 'no-opt'): BenchmarkSummary {
        const bestResult = results.reduce((best, current) => 
            current.opsPerSecond > best.opsPerSecond ? current : best
        )
        
        const worstResult = results.reduce((worst, current) => 
            current.opsPerSecond < worst.opsPerSecond ? current : worst
        )
        
        const avgTimeMs = results.reduce((sum, r) => sum + r.totalTimeMs, 0) / results.length
        const avgOpsPerSecond = Math.round(results.reduce((sum, r) => sum + r.opsPerSecond, 0) / results.length)
        
        const variance = results.reduce((sum, r) => {
            const diff = r.totalTimeMs - avgTimeMs
            return sum + (diff * diff)
        }, 0) / results.length
        const standardDeviation = Math.sqrt(variance)
        
        return {
            totalIterations: this.TOTAL_ITERATIONS,
            operationsPerIteration: this.OPERATIONS_PER_ITERATION,
            bestResult,
            worstResult,
            averageTimeMs: avgTimeMs,
            averageOpsPerSecond: avgOpsPerSecond,
            standardDeviation,
            optimizationMode
        }
    }
    
    private printSummary(summary: BenchmarkSummary): void {
        const modeEmoji = summary.optimizationMode === 'optimized' ? '⚡' : '🐢'
        console.log(`${modeEmoji} ${summary.optimizationMode.toUpperCase()} RESULTS SUMMARY`)
        console.log('='.repeat(40))
        console.log('')
        
        console.log('🏆 PERFORMANCE OVERVIEW:')
        console.log(`   ├─ Average Time: ${summary.averageTimeMs.toFixed(2)}ms per ${this.OPERATIONS_PER_ITERATION.toLocaleString()} operations`)
        console.log(`   ├─ Average Throughput: ${summary.averageOpsPerSecond.toLocaleString()} operations/second`)
        console.log(`   ├─ Average Time per Operation: ${(summary.averageTimeMs / this.OPERATIONS_PER_ITERATION).toFixed(6)}ms`)
        console.log(`   └─ Consistency (σ): ${summary.standardDeviation.toFixed(2)}ms`)
        console.log('')
        
        console.log('🥇 BEST: ' + `${summary.bestResult.totalTimeMs.toFixed(2)}ms (${summary.bestResult.opsPerSecond.toLocaleString()} ops/sec)`)
        console.log('🥉 WORST: ' + `${summary.worstResult.totalTimeMs.toFixed(2)}ms (${summary.worstResult.opsPerSecond.toLocaleString()} ops/sec)`)
        console.log('')
        
        const performanceRange = summary.worstResult.totalTimeMs - summary.bestResult.totalTimeMs
        const performanceVariation = (performanceRange / summary.averageTimeMs) * 100
        
        console.log('📈 CONSISTENCY ANALYSIS:')
        console.log(`   ├─ Variation: ${performanceVariation.toFixed(1)}%`)
        console.log(`   ├─ Slowdown Factor: ${(summary.worstResult.totalTimeMs / summary.bestResult.totalTimeMs).toFixed(2)}x`)
        console.log(`   └─ Rating: ${this.getConsistencyRating(performanceVariation)}`)
        console.log('')
    }
    
    compareOptimizations(optimized: BenchmarkSummary, noOpt: BenchmarkSummary): ComparisonResult {
        const speedupFactor = noOpt.averageTimeMs / optimized.averageTimeMs
        const optimizedVariation = (optimized.worstResult.totalTimeMs - optimized.bestResult.totalTimeMs) / optimized.averageTimeMs * 100
        const noOptVariation = (noOpt.worstResult.totalTimeMs - noOpt.bestResult.totalTimeMs) / noOpt.averageTimeMs * 100
        const consistencyDifference = Math.abs(optimizedVariation - noOptVariation)
        
        let recommendation = ''
        if (speedupFactor > 2 && consistencyDifference > 20) {
            recommendation = 'High optimization impact with consistency trade-off'
        } else if (speedupFactor > 2) {
            recommendation = 'Significant optimization benefit with good consistency'
        } else if (consistencyDifference > 20) {
            recommendation = 'Optimization improves consistency more than speed'
        } else {
            recommendation = 'Moderate optimization impact'
        }
        
        return {
            optimized,
            noOpt,
            optimizationImpact: {
                speedupFactor,
                consistencyDifference,
                recommendation
            }
        }
    }
    
    printOptimizationComparison(comparison: ComparisonResult): void {
        console.log('\n🔬 OPTIMIZATION IMPACT ANALYSIS')
        console.log('='.repeat(50))
        console.log('')
        
        console.log('⚡ OPTIMIZED vs 🐢 NO-OPT COMPARISON:')
        console.log(`   ├─ Speed Improvement: ${comparison.optimizationImpact.speedupFactor.toFixed(2)}x faster`)
        console.log(`   ├─ Optimized Throughput: ${comparison.optimized.averageOpsPerSecond.toLocaleString()} ops/sec`)
        console.log(`   ├─ No-Opt Throughput: ${comparison.noOpt.averageOpsPerSecond.toLocaleString()} ops/sec`)
        console.log(`   └─ Performance Gain: ${((comparison.optimizationImpact.speedupFactor - 1) * 100).toFixed(1)}%`)
        console.log('')
        
        const optVariation = (comparison.optimized.worstResult.totalTimeMs - comparison.optimized.bestResult.totalTimeMs) / comparison.optimized.averageTimeMs * 100
        const noOptVariation = (comparison.noOpt.worstResult.totalTimeMs - comparison.noOpt.bestResult.totalTimeMs) / comparison.noOpt.averageTimeMs * 100
        
        console.log('📊 CONSISTENCY COMPARISON:')
        console.log(`   ├─ Optimized Variation: ${optVariation.toFixed(1)}%`)
        console.log(`   ├─ No-Opt Variation: ${noOptVariation.toFixed(1)}%`)
        console.log(`   ├─ Consistency Difference: ${comparison.optimizationImpact.consistencyDifference.toFixed(1)}%`)
        console.log(`   └─ Better Consistency: ${optVariation < noOptVariation ? '⚡ Optimized' : '🐢 No-Opt'}`)
        console.log('')
        
        console.log('🎯 RECOMMENDATION:')
        console.log(`   ${comparison.optimizationImpact.recommendation}`)
        console.log('')
        
        console.log('📋 DETAILED BREAKDOWN:')
        console.log('   OPTIMIZED MODE:')
        console.log(`   ├─ Best: ${comparison.optimized.bestResult.totalTimeMs.toFixed(2)}ms`)
        console.log(`   ├─ Worst: ${comparison.optimized.worstResult.totalTimeMs.toFixed(2)}ms`)
        console.log(`   └─ Average: ${comparison.optimized.averageTimeMs.toFixed(2)}ms`)
        console.log('')
        console.log('   NO-OPT MODE:')
        console.log(`   ├─ Best: ${comparison.noOpt.bestResult.totalTimeMs.toFixed(2)}ms`)
        console.log(`   ├─ Worst: ${comparison.noOpt.worstResult.totalTimeMs.toFixed(2)}ms`)
        console.log(`   └─ Average: ${comparison.noOpt.averageTimeMs.toFixed(2)}ms`)
    }
    
    private getConsistencyRating(variation: number): string {
        if (variation < 5) return '🟢 EXCELLENT'
        if (variation < 10) return '🟡 GOOD'
        if (variation < 20) return '🟠 FAIR'
        return '🔴 POOR'
    }
}

describe('Frogger Optimization Comparison Benchmark', () => {
    let benchmarkSuite: SimpleFroggerBenchmark
    
    beforeEach(() => {
        benchmarkSuite = new SimpleFroggerBenchmark()
    })
    
    afterEach(() => { })

    it('should compare optimized vs non-optimized performance', async () => {
        console.log('\n🔬 FROGGER OPTIMIZATION ANALYSIS')
        console.log('='.repeat(60))
        console.log('Running comprehensive comparison of V8 optimization impact...')
        console.log('')
        
        console.log('Phase 1: Testing with V8 optimizations enabled...')
        const optimizedResults = await benchmarkSuite.runBenchmarkWithFlags([])
        
        console.log('\nPhase 2: Testing with V8 optimizations disabled...')
        const noOptResults = await benchmarkSuite.runBenchmarkWithFlags(['--no-opt'])
        
        const comparison = benchmarkSuite.compareOptimizations(optimizedResults, noOptResults)
        benchmarkSuite.printOptimizationComparison(comparison)
        
        expect(optimizedResults.totalIterations).toBe(10)
        expect(noOptResults.totalIterations).toBe(10)
        expect(optimizedResults.averageOpsPerSecond).toBeGreaterThan(0)
        expect(noOptResults.averageOpsPerSecond).toBeGreaterThan(0)
        
        expect(comparison.optimizationImpact.speedupFactor).toBeGreaterThan(1)
        
        console.log(`\n✅ Analysis complete: ${comparison.optimizationImpact.speedupFactor.toFixed(2)}x optimization speedup`)
    }, 60000)

    it('should show individual optimized benchmark', async () => {
        const summary = await benchmarkSuite.runBenchmark('optimized')
        
        expect(summary.averageOpsPerSecond).toBeGreaterThan(10000)
        expect(summary.optimizationMode).toBe('optimized')
        
        console.log(`\n🎯 Optimized mode completed: ${summary.averageOpsPerSecond.toLocaleString()} avg ops/sec`)
    }, 30000)
})