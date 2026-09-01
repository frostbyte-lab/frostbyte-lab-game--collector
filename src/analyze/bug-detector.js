/**
 * Bug Detector Module
 * Analisis dan deteksi bugs dalam game yang dikumpulkan
 * - Console errors & exceptions
 * - Missing dependencies & broken imports
 * - Logic errors & flow issues
 * - Memory leaks & infinite loops detection
 * - Dead code & unreachable logic
 */

export class BugDetector {
  constructor(zipFS, manifest) {
    this.zipFS = zipFS;
    this.manifest = manifest;
    this.bugs = [];
    this.warnings = [];
    this.errors = [];
  }

  /**
   * Jalankan deteksi bug lengkap
   */
  async detectAll() {
    console.log('[BugDetector] Starting comprehensive bug detection...');
    
    await Promise.all([
      this.detectMissingDependencies(),
      this.detectConsoleErrors(),
      this.detectInfiniteLoops(),
      this.detectNullReferences(),
      this.detectDeadCode(),
      this.detectCircularDependencies(),
      this.detectMemoryLeaks(),
    ]);

    return this.generateReport();
  }

  /**
   * Deteksi missing dependencies & broken imports
   */
  async detectMissingDependencies() {
    console.log('[BugDetector] Scanning for missing dependencies...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Detect import statements
        const importRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        
        while ((match = importRegex.exec(content)) !== null) {
          const moduleName = match[1];
          
          // Check if module exists
          if (!this.moduleExists(moduleName)) {
            this.bugs.push({
              type: 'MISSING_DEPENDENCY',
              severity: 'HIGH',
              file: file.path,
              module: moduleName,
              line: this.getLineNumber(content, match.index),
              message: `Missing module: ${moduleName}`,
              fix: `Install or mock module: ${moduleName}`
            });
          }
        }

        // Detect require() calls
        const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((match = requireRegex.exec(content)) !== null) {
          const moduleName = match[1];
          if (!this.moduleExists(moduleName)) {
            this.warnings.push({
              type: 'MISSING_REQUIRE',
              severity: 'MEDIUM',
              file: file.path,
              module: moduleName,
              line: this.getLineNumber(content, match.index),
              message: `Require not found: ${moduleName}`
            });
          }
        }
      } catch (err) {
        this.errors.push({
          type: 'FILE_READ_ERROR',
          file: file.path,
          message: err.message
        });
      }
    }
  }

  /**
   * Deteksi console errors & error handling
   */
  async detectConsoleErrors() {
    console.log('[BugDetector] Analyzing error handling...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Check for unhandled promise rejections
        const promiseRegex = /\.catch\s*\(\s*\)/g;
        if (promiseRegex.test(content)) {
          this.warnings.push({
            type: 'EMPTY_CATCH',
            severity: 'MEDIUM',
            file: file.path,
            message: 'Empty .catch() handler - errors may be silenced',
            fix: 'Add proper error handling in catch blocks'
          });
        }

        // Check for try-catch blocks
        const trycatchRegex = /try\s*{[\s\S]*?}\s*catch\s*\([^)]*\)\s*{[\s\S]*?}/g;
        const hasTryCatch = trycatchRegex.test(content);
        
        if (!hasTryCatch && content.includes('throw ')) {
          this.warnings.push({
            type: 'UNHANDLED_THROW',
            severity: 'MEDIUM',
            file: file.path,
            message: 'File has throw statements but no try-catch',
            fix: 'Add try-catch blocks or proper error handling'
          });
        }
      } catch (err) {
        // Skip file read errors
      }
    }
  }

  /**
   * Deteksi potential infinite loops
   */
  async detectInfiniteLoops() {
    console.log('[BugDetector] Scanning for infinite loops...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Detect while(true) loops
        const whileTrueRegex = /while\s*\(\s*(true|1)\s*\)/g;
        const whileMatches = content.match(whileTrueRegex);
        if (whileMatches) {
          this.warnings.push({
            type: 'INFINITE_LOOP',
            severity: 'HIGH',
            file: file.path,
            message: `Found ${whileMatches.length} while(true) loops - check for break conditions`,
            fix: 'Ensure all infinite loops have proper break conditions'
          });
        }

        // Detect recursive calls without base case
        const recursiveRegex = /function\s+(\w+)\s*\([^)]*\)\s*{[\s\S]*?\1\s*\(/;
        if (recursiveRegex.test(content)) {
          this.warnings.push({
            type: 'POSSIBLE_RECURSION',
            severity: 'MEDIUM',
            file: file.path,
            message: 'Recursive function detected - verify base case exists',
            fix: 'Check all recursive functions have proper termination conditions'
          });
        }
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Deteksi null/undefined references
   */
  async detectNullReferences() {
    console.log('[BugDetector] Scanning for null/undefined references...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Detect property access without null check
        const unsafeAccessRegex = /(\w+)\.(\w+)\s*(?!=|\?)/g;
        const matches = content.match(unsafeAccessRegex) || [];
        
        if (matches.length > 10) {
          this.warnings.push({
            type: 'UNSAFE_NULL_ACCESS',
            severity: 'MEDIUM',
            file: file.path,
            count: matches.length,
            message: `Found ${matches.length} potential unsafe property accesses`,
            fix: 'Use optional chaining (?.) or null checks'
          });
        }
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Deteksi dead code & unused imports
   */
  async detectDeadCode() {
    console.log('[BugDetector] Analyzing for dead code...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Detect imported but unused modules
        const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        
        while ((match = importRegex.exec(content)) !== null) {
          const varName = match[1];
          const usageRegex = new RegExp(`\\b${varName}\\b`, 'g');
          const usages = content.match(usageRegex) || [];
          
          // First match is the import itself
          if (usages.length === 1) {
            this.warnings.push({
              type: 'UNUSED_IMPORT',
              severity: 'LOW',
              file: file.path,
              variable: varName,
              message: `Unused import: ${varName}`,
              fix: `Remove unused import or use the variable`
            });
          }
        }

        // Detect unreachable code (after return)
        const unreachableRegex = /return[\s\S]*?;[\s\n]+([\s\S]*?)(?=function|\}|$)/;
        if (unreachableRegex.test(content)) {
          this.warnings.push({
            type: 'UNREACHABLE_CODE',
            severity: 'MEDIUM',
            file: file.path,
            message: 'Unreachable code detected after return statement',
            fix: 'Remove code after return or restructure logic'
          });
        }
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Deteksi circular dependencies
   */
  async detectCircularDependencies() {
    console.log('[BugDetector] Checking for circular dependencies...');
    
    const depGraph = {};
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    // Build dependency graph
    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        const imports = [];
        
        const importRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          imports.push(match[1]);
        }
        
        depGraph[file.path] = imports;
      } catch (err) {
        // Skip
      }
    }

    // Check for cycles
    this.findCycles(depGraph);
  }

  /**
   * Deteksi potential memory leaks
   */
  async detectMemoryLeaks() {
    console.log('[BugDetector] Scanning for memory leak patterns...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Check for event listeners without removal
        const addListenerRegex = /addEventListener\s*\(/g;
        const removeListenerRegex = /removeEventListener\s*\(/g;
        
        const addCount = (content.match(addListenerRegex) || []).length;
        const removeCount = (content.match(removeListenerRegex) || []).length;
        
        if (addCount > removeCount * 2) {
          this.warnings.push({
            type: 'POTENTIAL_MEMORY_LEAK',
            severity: 'MEDIUM',
            file: file.path,
            listeners: { added: addCount, removed: removeCount },
            message: `More addEventListener (${addCount}) than removeEventListener (${removeCount})`,
            fix: 'Ensure all event listeners are properly cleaned up'
          });
        }

        // Check for interval/timeout without clearing
        const setIntervalRegex = /setInterval\s*\(/g;
        const clearIntervalRegex = /clearInterval\s*\(/g;
        
        const setCount = (content.match(setIntervalRegex) || []).length;
        const clearCount = (content.match(clearIntervalRegex) || []).length;
        
        if (setCount > clearCount) {
          this.warnings.push({
            type: 'UNCLEANED_INTERVAL',
            severity: 'MEDIUM',
            file: file.path,
            message: `Found ${setCount} setInterval but only ${clearCount} clearInterval`,
            fix: 'Always clear intervals with clearInterval() in cleanup'
          });
        }
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Helper: Check if module exists in assets
   */
  moduleExists(moduleName) {
    // Check for .js/.ts files
    const paths = [
      `${moduleName}.js`,
      `${moduleName}/index.js`,
      `${moduleName}.mjs`,
      `${moduleName}/index.mjs`
    ];

    return paths.some(p => 
      this.manifest.assets?.some(a => a.path?.endsWith(p))
    );
  }

  /**
   * Helper: Get line number of match in content
   */
  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Helper: Find cycles in dependency graph
   */
  findCycles(graph, visited = {}, recStack = {}, path = []) {
    Object.entries(graph).forEach(([file, deps]) => {
      if (!visited[file]) {
        visited[file] = true;
        recStack[file] = true;
        path.push(file);

        deps.forEach(dep => {
          if (!visited[dep] && graph[dep]) {
            this.findCycles(graph, visited, recStack, path);
          } else if (recStack[dep]) {
            this.bugs.push({
              type: 'CIRCULAR_DEPENDENCY',
              severity: 'MEDIUM',
              cycle: [...path, dep].join(' → '),
              message: `Circular dependency detected: ${path.join(' → ')} → ${dep}`,
              fix: 'Refactor to remove circular imports'
            });
          }
        });

        path.pop();
        recStack[file] = false;
      }
    });
  }

  /**
   * Generate detailed bug report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total_bugs: this.bugs.length,
        total_warnings: this.warnings.length,
        total_errors: this.errors.length,
        severity_breakdown: {
          critical: this.bugs.filter(b => b.severity === 'CRITICAL').length,
          high: this.bugs.filter(b => b.severity === 'HIGH').length,
          medium: this.bugs.filter(b => b.severity === 'MEDIUM').length,
          low: this.bugs.filter(b => b.severity === 'LOW').length
        }
      },
      bugs: this.bugs.sort((a, b) => {
        const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (severityOrder[a.severity] || 999) - (severityOrder[b.severity] || 999);
      }),
      warnings: this.warnings,
      errors: this.errors,
      recommendation: this.generateRecommendation()
    };

    return report;
  }

  /**
   * Generate recommendations based on bugs found
   */
  generateRecommendation() {
    const criticalBugs = this.bugs.filter(b => b.severity === 'CRITICAL');
    const highBugs = this.bugs.filter(b => b.severity === 'HIGH');

    let recommendation = [];

    if (criticalBugs.length > 0) {
      recommendation.push('⛔ CRITICAL: Fix these issues before testing offline');
    }

    if (highBugs.length > 0) {
      recommendation.push('⚠️ HIGH: These issues may cause offline failures');
    }

    if (this.warnings.length > 0) {
      recommendation.push('ℹ️ Review warnings for potential offline issues');
    }

    return recommendation;
  }
}

export default BugDetector;
