/**
 * Ollama AI Integration Module
 * Mengintegrasikan Ollama untuk analisis cerdas & rekomendasi otomatis
 * - Bug analysis dengan AI
 * - Security recommendations
 * - Automatic code fix generation
 * - Smart dependency resolution
 */

export class OllamaAIIntegration {
  constructor(ollamaConfig = {}) {
    this.baseURL = ollamaConfig.baseURL || 'http://localhost:11434';
    this.model = ollamaConfig.model || 'llama2'; // Bisa ganti ke mistral, neural-chat, dll
    this.timeout = ollamaConfig.timeout || 60000;
    this.streaming = ollamaConfig.streaming || true;
  }

  /**
   * Test koneksi ke Ollama
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.baseURL}/api/tags`, {
        method: 'GET',
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error(`Ollama connection failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        status: 'connected',
        available_models: data.models || [],
        current_model: this.model
      };
    } catch (err) {
      return {
        status: 'disconnected',
        error: err.message,
        hint: 'Make sure Ollama is running: ollama serve'
      };
    }
  }

  /**
   * Analyze bugs dengan AI
   */
  async analyzeBugsWithAI(bugReport) {
    console.log('[OllamaAI] Analyzing bugs with AI...');

    const prompt = `Analyze these bugs dan berikan rekomendasi fix terperinci:

${JSON.stringify(bugReport.bugs.slice(0, 5), null, 2)}

Untuk setiap bug:
1. Jelaskan root cause
2. Berikan solusi concrete
3. Rate severity (critical/high/medium/low)
4. Estimasi effort untuk fix (hours)

Format respons JSON.`;

    try {
      const analysis = await this.query(prompt);
      
      return {
        timestamp: new Date().toISOString(),
        ai_analysis: analysis,
        recommendations: this.parseAIResponse(analysis),
        confidence_score: this.calculateConfidence(analysis)
      };
    } catch (err) {
      return {
        error: err.message,
        fallback: 'AI analysis failed, gunakan manual review'
      };
    }
  }

  /**
   * Security recommendations dari AI
   */
  async getSecurityRecommendations(securityReport) {
    console.log('[OllamaAI] Generating security recommendations...');

    const prompt = `Sebagai security expert, review vulnerabilities ini dan prioritaskan fix:

${JSON.stringify(securityReport.vulnerabilities.slice(0, 5), null, 2)}

Untuk setiap vulnerability:
1. CVSS Score estimate
2. Attack vector & impact
3. Specific fix code
4. Prevention best practice

Format JSON dengan fields: vulnerability_id, risk_level, fix_code, prevention.`;

    try {
      const recommendations = await this.query(prompt);
      
      return {
        timestamp: new Date().toISOString(),
        security_analysis: recommendations,
        risk_assessment: this.assessSecurityRisks(recommendations),
        immediate_actions: this.extractImmediateActions(recommendations)
      };
    } catch (err) {
      return {
        error: err.message,
        fallback: 'Security analysis failed'
      };
    }
  }

  /**
   * Generate automatic code fixes
   */
  async generateCodeFixes(bugReport, sourceCode = {}) {
    console.log('[OllamaAI] Generating code fixes...');

    const criticalBugs = bugReport.bugs.filter(b => b.severity === 'CRITICAL').slice(0, 3);

    const prompt = `Generate exact code fixes untuk bugs ini:

${JSON.stringify(criticalBugs, null, 2)}

Source code sample:
${Object.entries(sourceCode).slice(0, 2).map(([file, code]) => 
  `\n// File: ${file}\n${code.substring(0, 500)}...`
).join('\n')}

Untuk setiap bug:
1. Exact before/after code
2. File path
3. Line numbers
4. Explanation

Format sebagai array dari {file, lineNumber, beforeCode, afterCode, explanation}.`;

    try {
      const fixes = await this.query(prompt);
      
      return {
        timestamp: new Date().toISOString(),
        generated_fixes: this.parseCodeFixes(fixes),
        total_fixes: this.countFixes(fixes),
        review_required: true, // Always require human review
        apply_fixes: this.createFixPatcher(fixes)
      };
    } catch (err) {
      return {
        error: err.message,
        fallback: 'Code generation failed'
      };
    }
  }

  /**
   * AI Code Review
   */
  async performCodeReview(filePath, codeContent) {
    console.log(`[OllamaAI] Reviewing code: ${filePath}`);

    const prompt = `Review code ini untuk offline game mode:

File: ${filePath}
\`\`\`javascript
${codeContent}
\`\`\`

Analisis:
1. Code quality issues
2. Potential runtime errors
3. Offline compatibility issues
4. Performance concerns
5. Security vulnerabilities
6. Suggested improvements

Format response sebagai JSON dengan fields: issues[], quality_score (0-100), offline_ready (true/false).`;

    try {
      const review = await this.query(prompt);
      
      return {
        file: filePath,
        timestamp: new Date().toISOString(),
        review_analysis: review,
        quality_score: this.extractQualityScore(review),
        offline_compatible: this.isOfflineCompatible(review),
        issues: this.parseIssues(review),
        recommendations: this.extractRecommendations(review)
      };
    } catch (err) {
      return {
        file: filePath,
        error: err.message,
        fallback: 'Code review failed'
      };
    }
  }

  /**
   * Resolve circular dependencies dengan AI
   */
  async resolveCircularDependencies(depAnalysis) {
    console.log('[OllamaAI] Resolving circular dependencies...');

    const cycles = depAnalysis.circular_dependencies.slice(0, 3);

    const prompt = `Bantu resolve circular dependencies ini:

${JSON.stringify(cycles, null, 2)}

Untuk setiap cycle:
1. Root cause analysis
2. Refactoring strategy
3. Exact code changes needed
4. Testing approach

Format sebagai action items dengan file, change description, dan code snippet.`;

    try {
      const solution = await this.query(prompt);
      
      return {
        timestamp: new Date().toISOString(),
        circular_analysis: solution,
        resolution_steps: this.parseResolutionSteps(solution),
        complexity_score: this.assessRefactoringComplexity(solution),
        estimated_effort_hours: this.estimateRefactoringEffort(solution)
      };
    } catch (err) {
      return {
        error: err.message,
        fallback: 'Circular dependency resolution failed'
      };
    }
  }

  /**
   * Generate comprehensive offline strategy
   */
  async generateOfflineStrategy(fullAnalysis) {
    console.log('[OllamaAI] Generating offline strategy...');

    const prompt = `Sebagai game architect, buat comprehensive strategy untuk offline mode:

Game Info:
- Client code: ${fullAnalysis.summary.bugs.high}% quality
- Security score: ${fullAnalysis.security_report.security_score}/100
- Circular deps: ${fullAnalysis.dependency_analysis.summary.circular_dependencies}
- API endpoints: ${Object.keys(fullAnalysis.mock_generation.api_mocks || {}).length}

Berikan:
1. Phased implementation plan (P0/P1/P2)
2. Mock strategy untuk setiap endpoint
3. State management approach
4. Fallback data handling
5. Testing strategy
6. Rollout plan

Format sebagai structured plan dengan timeline dan success criteria.`;

    try {
      const strategy = await this.query(prompt);
      
      return {
        timestamp: new Date().toISOString(),
        strategy: strategy,
        implementation_plan: this.parseImplementationPlan(strategy),
        phases: this.extractPhases(strategy),
        success_criteria: this.extractSuccessCriteria(strategy),
        risks: this.identifyRisks(strategy)
      };
    } catch (err) {
      return {
        error: err.message,
        fallback: 'Strategy generation failed'
      };
    }
  }

  /**
   * Main query function untuk Ollama
   */
  async query(prompt, streaming = this.streaming) {
    const requestBody = {
      model: this.model,
      prompt: prompt,
      stream: streaming,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40
    };

    try {
      const response = await fetch(`${this.baseURL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        timeout: this.timeout
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      if (streaming) {
        return await this.handleStreamingResponse(response);
      } else {
        const data = await response.json();
        return data.response;
      }
    } catch (err) {
      console.error('[OllamaAI] Query failed:', err);
      throw err;
    }
  }

  /**
   * Handle streaming response dari Ollama
   */
  async handleStreamingResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line);
              if (json.response) {
                fullResponse += json.response;
              }
              if (json.done) {
                return fullResponse;
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } catch (err) {
      console.error('Error reading stream:', err);
    }

    return fullResponse;
  }

  /**
   * Parse AI response ke structured format
   */
  parseAIResponse(response) {
    try {
      // Coba extract JSON dari response
      const jsonMatch = response.match(/\\{[^{}]*\\}|\\[.*\\]/s);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Fallback ke text parsing
    }

    return {\n      raw_response: response,\n      requires_manual_review: true\n    };\n  }\n\n  /**\n   * Parse code fixes dari AI response\n   */\n  parseCodeFixes(response) {\n    try {\n      const jsonMatch = response.match(/\\[\\s*{[^{}]*}\\s*(?:,\\s*{[^{}]*}\\s*)*\\]/s);\n      if (jsonMatch) {\n        return JSON.parse(jsonMatch[0]);\n      }\n    } catch (e) {\n      // Fallback\n    }\n\n    return [];\n  }\n\n  /**\n   * Helper functions\n   */\n  calculateConfidence(response) {\n    // Heuristic: lebih panjang response = lebih confident\n    return Math.min(100, Math.floor((response.length / 1000) * 85));\n  }\n\n  assessSecurityRisks(response) {\n    // Extract risk levels dari response\n    const high = (response.match(/high/gi) || []).length;\n    const critical = (response.match(/critical/gi) || []).length;\n    return {\n      critical_risks: critical,\n      high_risks: high,\n      needs_immediate_action: critical > 0\n    };\n  }\n\n  extractImmediateActions(response) {\n    // Parse immediate actions dari response\n    const actions = response.split('\\n').filter(line => \n      line.match(/^\\d+\\.|^-|^\\*/)\n    ).slice(0, 5);\n    return actions;\n  }\n\n  countFixes(response) {\n    return (response.match(/beforeCode|fix|patch/gi) || []).length;\n  }\n\n  createFixPatcher(fixes) {\n    return (zipFS) => {\n      // Return function untuk apply fixes ke zipFS\n      return async () => {\n        console.log('Applying AI-generated fixes...');\n        // Implementation untuk apply fixes\n      };\n    };\n  }\n\n  extractQualityScore(review) {\n    const match = review.match(/quality[_-]?score[:\\s]+(\\d+)/i);\n    return match ? parseInt(match[1]) : 50;\n  }\n\n  isOfflineCompatible(review) {\n    return !review.toLowerCase().includes('not compatible') &&\n           !review.toLowerCase().includes('requires online');\n  }\n\n  parseIssues(review) {\n    const issues = [];\n    const lines = review.split('\\n');\n    lines.forEach(line => {\n      if (line.match(/^-|^\\d+\\.|issue/i)) {\n        issues.push(line.trim());\n      }\n    });\n    return issues;\n  }\n\n  extractRecommendations(review) {\n    const recommendations = [];\n    const lines = review.split('\\n');\n    lines.forEach((line, idx) => {\n      if (line.match(/recommend|suggest|improve/i)) {\n        recommendations.push(line.trim());\n      }\n    });\n    return recommendations;\n  }\n\n  parseResolutionSteps(solution) {\n    return solution.split('\\n').filter(line => \n      line.match(/^\\d+\\.|^-|^\\*/) && line.length > 0\n    );\n  }\n\n  assessRefactoringComplexity(solution) {\n    const complexity = solution.toLowerCase().includes('complex') ? 'high' :\n                       solution.toLowerCase().includes('moderate') ? 'medium' : 'low';\n    return complexity;\n  }\n\n  estimateRefactoringEffort(solution) {\n    const hasComplex = solution.toLowerCase().includes('complex');\n    const hasMultipleChanges = (solution.match(/file|change|refactor/gi) || []).length > 5;\n    return hasComplex ? 16 : hasMultipleChanges ? 8 : 4;\n  }\n\n  parseImplementationPlan(strategy) {\n    return strategy.split('\\n\\n').slice(0, 5);\n  }\n\n  extractPhases(strategy) {\n    const phases = {};\n    const phaseMatch = strategy.match(/Phase [0-4][^]*?(?=Phase|$)/gi);\n    if (phaseMatch) {\n      phaseMatch.forEach((phase, idx) => {\n        phases[`phase_${idx + 1}`] = phase.substring(0, 200);\n      });\n    }\n    return phases;\n  }\n\n  extractSuccessCriteria(strategy) {\n    const criteria = strategy.split('\\n').filter(line => \n      line.match(/criterion|criteria|success|metric/i)\n    ).slice(0, 5);\n    return criteria;\n  }\n\n  identifyRisks(strategy) {\n    return strategy.split('\\n').filter(line => \n      line.match(/risk|issue|challenge|problem/i)\n    ).slice(0, 5);\n  }\n}\n\nexport default OllamaAIIntegration;\n