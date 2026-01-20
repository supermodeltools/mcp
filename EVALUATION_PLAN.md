# SWE-Bench-Lite Evaluation Plan: Supermodel MCP Performance Analysis

## Executive Summary

This document outlines a rigorous, scientifically sound methodology for evaluating the Supermodel MCP server's impact on software engineering task performance using SWE-Bench-Lite. The goal is to produce peer-reviewable, reproducible results suitable for academic publication.

**Research Question**: Does providing Claude with deep codebase analysis capabilities via the Supermodel MCP server significantly improve performance on real-world software engineering tasks?

**Hypothesis**: Claude with Supermodel MCP will demonstrate statistically significant improvements in task resolution rate, solution quality, and efficiency compared to baseline Claude without specialized codebase analysis tools.

---

## 1. Repository Structure

Create a new repository: `supermodel-swebench-eval`

```
supermodel-swebench-eval/
├── README.md                          # Project overview, setup instructions
├── LICENSE                            # MIT or Apache 2.0
├── .gitignore                         # Ignore large files, credentials
├── requirements.txt                   # Python dependencies
├── package.json                       # Node dependencies (for MCP)
├── docker/
│   ├── Dockerfile                     # Reproducible environment
│   └── docker-compose.yml             # Multi-container setup
├── config/
│   ├── experiment_config.yaml         # Experiment parameters
│   ├── baseline_config.yaml           # Baseline Claude configuration
│   └── supermodel_config.yaml         # Supermodel-enhanced configuration
├── src/
│   ├── __init__.py
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── base_agent.py              # Abstract base agent
│   │   ├── baseline_agent.py          # Claude without MCP
│   │   └── supermodel_agent.py        # Claude with Supermodel MCP
│   ├── harness/
│   │   ├── __init__.py
│   │   ├── executor.py                # Main execution engine
│   │   ├── sandbox.py                 # Isolated execution environment
│   │   ├── validator.py               # Test execution and validation
│   │   └── monitor.py                 # Resource and cost tracking
│   ├── data/
│   │   ├── __init__.py
│   │   ├── loader.py                  # SWE-Bench dataset loading
│   │   ├── preprocessor.py            # Data preparation
│   │   └── stratifier.py              # Stratified sampling
│   ├── evaluation/
│   │   ├── __init__.py
│   │   ├── metrics.py                 # Evaluation metrics
│   │   ├── statistical_analysis.py    # Statistical tests
│   │   └── qualitative_analysis.py    # Manual review framework
│   └── utils/
│       ├── __init__.py
│       ├── logging.py                 # Structured logging
│       ├── caching.py                 # Result caching
│       └── git_utils.py               # Repository management
├── scripts/
│   ├── 01_setup_environment.sh        # Environment setup
│   ├── 02_download_dataset.sh         # Download SWE-Bench-Lite
│   ├── 03_prepare_instances.py        # Instance preparation
│   ├── 04_run_baseline.py             # Run baseline evaluation
│   ├── 05_run_supermodel.py           # Run Supermodel evaluation
│   ├── 06_analyze_results.py          # Statistical analysis
│   ├── 07_generate_report.py          # Generate paper-ready results
│   └── 08_cost_analysis.py            # Cost breakdown
├── notebooks/
│   ├── exploratory_analysis.ipynb     # Initial data exploration
│   ├── results_analysis.ipynb         # Detailed result analysis
│   └── visualization.ipynb            # Paper-quality figures
├── tests/
│   ├── __init__.py
│   ├── test_agent.py                  # Agent unit tests
│   ├── test_harness.py                # Harness unit tests
│   ├── test_integration.py            # End-to-end tests
│   └── test_reproducibility.py        # Reproducibility checks
├── data/
│   ├── raw/                           # Original SWE-Bench data
│   ├── processed/                     # Preprocessed instances
│   ├── stratified/                    # Stratified samples
│   └── cache/                         # Cached API responses
├── results/
│   ├── baseline/                      # Baseline run results
│   │   ├── traces/                    # Full execution traces
│   │   ├── patches/                   # Generated patches
│   │   └── metrics/                   # Per-instance metrics
│   ├── supermodel/                    # Supermodel run results
│   │   ├── traces/
│   │   ├── patches/
│   │   └── metrics/
│   ├── analysis/                      # Statistical analysis outputs
│   └── figures/                       # Publication-ready figures
├── docs/
│   ├── methodology.md                 # Detailed methodology
│   ├── experimental_protocol.md       # Step-by-step protocol
│   ├── results.md                     # Results documentation
│   ├── threats_to_validity.md         # Validity threats analysis
│   └── reproduction_guide.md          # Exact reproduction steps
└── paper/
    ├── main.tex                       # LaTeX paper draft
    ├── sections/                      # Paper sections
    ├── tables/                        # Generated tables
    └── figures/                       # Paper figures
```

---

## 2. Experimental Design

### 2.1 Research Design

**Design Type**: Between-subjects experimental design with randomized controlled trial methodology

**Independent Variable**: Agent configuration (Baseline vs. Supermodel-enhanced)

**Dependent Variables**:
- **Primary**: Task resolution rate (% of instances where tests pass)
- **Secondary**:
  - Solution quality (patch correctness, minimal changes)
  - Time to resolution (wall-clock time)
  - Token efficiency (tokens per successful resolution)
  - Tool usage patterns
  - First-attempt success rate
  - Cost per resolution

### 2.2 Dataset Selection

**Dataset**: SWE-Bench-Lite (300 instances)

**Justification**:
- Curated subset of most solvable, high-quality instances from SWE-Bench
- Validated test cases and patches
- Diverse repositories (Django, Flask, scikit-learn, matplotlib, etc.)
- Manageable evaluation time and cost

**Stratification Criteria**:
- Repository diversity (ensure balanced representation)
- Issue complexity (easy, medium, hard based on metadata)
- Task type (bug fix, feature addition, refactoring)
- File count impact (small, medium, large scope)

### 2.3 Sample Size and Power Analysis

```python
# scripts/power_analysis.py
# Calculate required sample size for statistical significance

# Assumptions:
# - Expected baseline resolution rate: 15-20% (based on published SWE-Bench results)
# - Expected improvement with Supermodel: 5-10 percentage points
# - Desired power: 0.80
# - Significance level: α = 0.05

# Preliminary estimate: Full 300 instances provides adequate power
# Run pilot study (30 instances) to refine estimates
```

### 2.4 Randomization and Blinding

**Randomization**:
- Use stratified random sampling to ensure balanced representation
- Fixed random seed (42) for reproducibility
- Document seed and sampling strategy

**Blinding**:
- Not applicable (automated evaluation)
- Human qualitative analysis will use anonymized condition labels

### 2.5 Control Variables

**Fixed across conditions**:
- Claude model version: `claude-sonnet-4-5-20250929`
- Temperature: 0.0 (deterministic)
- Max tokens: 100,000 (extended thinking enabled)
- System prompt structure
- Timeout per instance: 30 minutes
- Maximum conversation turns: 50
- Execution environment (Docker container specs)

**Baseline Agent Tools**:
- File reading/writing
- Code search (grep, glob)
- Shell command execution
- File tree exploration
- LSP capabilities (if available in SWE-Bench setup)

**Supermodel Agent Additional Tools**:
- `analyze_codebase` with full Supermodel capabilities

---

## 3. Implementation Specifications

### 3.1 Agent Implementation

```python
# src/agent/base_agent.py
from abc import ABC, abstractmethod
from typing import Dict, List, Optional
import anthropic

class BaseAgent(ABC):
    """Abstract base class for SWE-Bench agents."""

    def __init__(self, config: Dict):
        self.config = config
        self.client = anthropic.Anthropic(
            api_key=config['anthropic_api_key']
        )
        self.model = config.get('model', 'claude-sonnet-4-5-20250929')
        self.temperature = config.get('temperature', 0.0)
        self.max_tokens = config.get('max_tokens', 100000)

    @abstractmethod
    def solve_instance(self, instance: Dict) -> Dict:
        """
        Solve a single SWE-Bench instance.

        Returns:
            {
                'instance_id': str,
                'patch': str,
                'conversation': List[Dict],
                'metadata': Dict,
                'resolved': bool,
                'error': Optional[str]
            }
        """
        pass

    def _create_system_prompt(self) -> str:
        """Create system prompt for the agent."""
        return """You are an expert software engineer tasked with fixing bugs and implementing features.

Your task:
1. Analyze the issue description and repository
2. Locate the relevant code
3. Generate a patch that fixes the issue
4. Ensure all existing tests pass

Provide your final solution as a unified diff patch."""

    def _create_task_prompt(self, instance: Dict) -> str:
        """Create task-specific prompt."""
        return f"""Repository: {instance['repo']}
Base commit: {instance['base_commit']}

Issue:
{instance['problem_statement']}

Hints (files that may be relevant):
{instance.get('hints', {}).get('files', [])}

Please analyze the codebase, identify the bug/feature location, and generate a patch to fix it."""
```

```python
# src/agent/baseline_agent.py
from .base_agent import BaseAgent

class BaselineAgent(BaseAgent):
    """Claude agent with standard code tools (no MCP)."""

    def solve_instance(self, instance: Dict) -> Dict:
        # Standard Anthropic API call without MCP
        response = self.client.messages.create(
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            system=self._create_system_prompt(),
            messages=[{
                'role': 'user',
                'content': self._create_task_prompt(instance)
            }]
        )

        # Extract patch and metadata
        return self._process_response(instance, response)
```

```python
# src/agent/supermodel_agent.py
from .base_agent import BaseAgent

class SupermodelAgent(BaseAgent):
    """Claude agent with Supermodel MCP server enabled."""

    def solve_instance(self, instance: Dict) -> Dict:
        # Enable MCP with Supermodel server
        response = self.client.messages.create(
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            system=self._create_system_prompt(),
            messages=[{
                'role': 'user',
                'content': self._create_task_prompt(instance)
            }],
            betas=['mcp-1'],
            mcp_servers={
                'supermodel': {
                    'command': 'npx',
                    'args': ['-y', '@supermodeltools/mcp-server'],
                    'env': {
                        'SUPERMODEL_API_KEY': self.config['supermodel_api_key']
                    }
                }
            }
        )

        return self._process_response(instance, response)
```

### 3.2 Execution Harness

```python
# src/harness/executor.py
import docker
import logging
from typing import Dict, List
from concurrent.futures import ProcessPoolExecutor, TimeoutError

class ExecutionHarness:
    """Main execution harness for SWE-Bench evaluation."""

    def __init__(self, config: Dict):
        self.config = config
        self.docker_client = docker.from_env()
        self.logger = logging.getLogger(__name__)

    def run_evaluation(
        self,
        instances: List[Dict],
        agent_class,
        output_dir: str,
        num_workers: int = 1
    ) -> List[Dict]:
        """
        Run full evaluation on a set of instances.

        Args:
            instances: List of SWE-Bench instances
            agent_class: Agent class to instantiate
            output_dir: Directory for results
            num_workers: Parallel workers (1 for sequential, >1 for parallel)

        Returns:
            List of result dictionaries
        """
        results = []

        if num_workers == 1:
            # Sequential execution for determinism
            for instance in instances:
                result = self._run_single_instance(
                    instance, agent_class, output_dir
                )
                results.append(result)
        else:
            # Parallel execution for speed
            with ProcessPoolExecutor(max_workers=num_workers) as executor:
                futures = [
                    executor.submit(
                        self._run_single_instance,
                        instance,
                        agent_class,
                        output_dir
                    )
                    for instance in instances
                ]

                for future in futures:
                    try:
                        result = future.result(timeout=1800)  # 30 min
                        results.append(result)
                    except TimeoutError:
                        self.logger.error(f"Instance timed out")
                        results.append({'error': 'timeout'})
                    except Exception as e:
                        self.logger.error(f"Instance failed: {e}")
                        results.append({'error': str(e)})

        return results

    def _run_single_instance(
        self,
        instance: Dict,
        agent_class,
        output_dir: str
    ) -> Dict:
        """
        Run a single instance in isolated Docker environment.

        Steps:
        1. Create Docker container with repository at base_commit
        2. Initialize agent
        3. Run agent to generate patch
        4. Apply patch in container
        5. Run test suite
        6. Collect metrics and results
        7. Clean up container
        """
        container = None
        try:
            # Setup isolated environment
            container = self._create_container(instance)

            # Run agent
            agent = agent_class(self.config)
            agent_result = agent.solve_instance(instance)

            # Validate solution
            validation_result = self._validate_solution(
                container, instance, agent_result['patch']
            )

            # Collect comprehensive results
            result = {
                'instance_id': instance['instance_id'],
                'resolved': validation_result['all_tests_passed'],
                'patch': agent_result['patch'],
                'conversation_length': len(agent_result['conversation']),
                'total_tokens': agent_result['metadata']['total_tokens'],
                'execution_time': agent_result['metadata']['execution_time'],
                'tool_calls': agent_result['metadata']['tool_calls'],
                'test_results': validation_result,
                'error': agent_result.get('error')
            }

            # Save detailed trace
            self._save_trace(result, output_dir)

            return result

        except Exception as e:
            self.logger.error(f"Failed to run {instance['instance_id']}: {e}")
            return {
                'instance_id': instance['instance_id'],
                'resolved': False,
                'error': str(e)
            }
        finally:
            if container:
                container.stop()
                container.remove()

    def _create_container(self, instance: Dict) -> docker.Container:
        """Create isolated Docker container for instance."""
        # Pull repository and checkout base commit
        # Install dependencies
        # Return container handle
        pass

    def _validate_solution(
        self,
        container: docker.Container,
        instance: Dict,
        patch: str
    ) -> Dict:
        """Apply patch and run test suite."""
        # Apply patch
        # Run test command
        # Parse test results
        # Return validation metrics
        pass
```

### 3.3 Metrics Collection

```python
# src/evaluation/metrics.py
import numpy as np
from typing import Dict, List
from scipy import stats

class MetricsCollector:
    """Comprehensive metrics collection and analysis."""

    @staticmethod
    def calculate_primary_metrics(results: List[Dict]) -> Dict:
        """Calculate primary evaluation metrics."""
        total = len(results)
        resolved = sum(1 for r in results if r['resolved'])

        return {
            'resolution_rate': resolved / total,
            'resolved_count': resolved,
            'total_count': total,
            'failure_count': total - resolved
        }

    @staticmethod
    def calculate_secondary_metrics(results: List[Dict]) -> Dict:
        """Calculate secondary metrics."""
        resolved_results = [r for r in results if r['resolved']]

        if not resolved_results:
            return {}

        return {
            'avg_tokens_per_resolution': np.mean([
                r['total_tokens'] for r in resolved_results
            ]),
            'avg_execution_time': np.mean([
                r['execution_time'] for r in resolved_results
            ]),
            'avg_conversation_length': np.mean([
                r['conversation_length'] for r in resolved_results
            ]),
            'first_attempt_success_rate': sum(
                1 for r in resolved_results
                if r['conversation_length'] <= 2
            ) / len(resolved_results)
        }

    @staticmethod
    def calculate_cost_metrics(results: List[Dict], pricing: Dict) -> Dict:
        """Calculate cost metrics."""
        total_input_tokens = sum(r['metadata']['input_tokens'] for r in results)
        total_output_tokens = sum(r['metadata']['output_tokens'] for r in results)

        total_cost = (
            total_input_tokens * pricing['input_token_price'] +
            total_output_tokens * pricing['output_token_price']
        )

        resolved = sum(1 for r in results if r['resolved'])
        cost_per_resolution = total_cost / resolved if resolved > 0 else float('inf')

        return {
            'total_cost': total_cost,
            'cost_per_instance': total_cost / len(results),
            'cost_per_resolution': cost_per_resolution,
            'total_input_tokens': total_input_tokens,
            'total_output_tokens': total_output_tokens
        }

    @staticmethod
    def compare_conditions(
        baseline_results: List[Dict],
        supermodel_results: List[Dict]
    ) -> Dict:
        """Statistical comparison between conditions."""

        baseline_resolved = [r['resolved'] for r in baseline_results]
        supermodel_resolved = [r['resolved'] for r in supermodel_results]

        # Chi-square test for resolution rates
        contingency_table = [
            [sum(baseline_resolved), len(baseline_resolved) - sum(baseline_resolved)],
            [sum(supermodel_resolved), len(supermodel_resolved) - sum(supermodel_resolved)]
        ]
        chi2, p_value, dof, expected = stats.chi2_contingency(contingency_table)

        # Effect size (Cohen's h)
        p1 = sum(baseline_resolved) / len(baseline_resolved)
        p2 = sum(supermodel_resolved) / len(supermodel_resolved)
        cohens_h = 2 * (np.arcsin(np.sqrt(p2)) - np.arcsin(np.sqrt(p1)))

        # Confidence intervals (95%)
        baseline_ci = stats.binom.interval(
            0.95, len(baseline_resolved), p1
        )
        supermodel_ci = stats.binom.interval(
            0.95, len(supermodel_resolved), p2
        )

        return {
            'chi_square': chi2,
            'p_value': p_value,
            'effect_size_cohens_h': cohens_h,
            'baseline_rate': p1,
            'supermodel_rate': p2,
            'improvement': p2 - p1,
            'relative_improvement': (p2 - p1) / p1 if p1 > 0 else float('inf'),
            'baseline_ci': baseline_ci,
            'supermodel_ci': supermodel_ci,
            'statistically_significant': p_value < 0.05
        }
```

---

## 4. Execution Protocol

### 4.1 Pre-Execution Checklist

- [ ] Repository created and all dependencies installed
- [ ] Docker images built and tested
- [ ] SWE-Bench-Lite dataset downloaded (300 instances)
- [ ] Stratified sampling completed and documented
- [ ] API keys configured (Anthropic, Supermodel)
- [ ] Baseline agent tested on 3 sample instances
- [ ] Supermodel agent tested on 3 sample instances
- [ ] Logging and monitoring configured
- [ ] Storage space verified (>100GB recommended)
- [ ] Cost budget approved and tracking enabled

### 4.2 Pilot Study (30 instances)

**Purpose**: Validate methodology, refine protocols, estimate costs

1. Run 15 baseline instances (stratified sample)
2. Run 15 supermodel instances (matched pairs)
3. Analyze results and identify issues
4. Refine agent prompts if needed (document all changes)
5. Estimate total cost and time for full evaluation
6. Update power analysis if needed

**Acceptance Criteria**:
- No systematic execution failures
- Results are reproducible (run same instance twice → same result)
- Cost per instance is within budget
- Data collection is complete

### 4.3 Main Evaluation

**Execution Order**:
1. Run all 300 baseline instances first (prevents cross-contamination)
2. Verify baseline results and data integrity
3. Run all 300 supermodel instances
4. Verify supermodel results and data integrity

**Quality Checks** (after each batch of 50 instances):
- Check resolution rates (should be in expected range)
- Verify all traces are saved
- Check for execution errors
- Monitor costs
- Verify Docker cleanup (prevent resource exhaustion)

**Fault Tolerance**:
- Implement checkpointing (save results every 10 instances)
- On failure, resume from last checkpoint
- Log all errors with full stack traces
- Implement automatic retry (max 3 attempts) for transient failures

### 4.4 Post-Execution Validation

- [ ] All 600 runs completed (300 baseline + 300 supermodel)
- [ ] No missing data in results files
- [ ] Execution traces saved for all instances
- [ ] Patches extracted for all attempts
- [ ] Test results recorded for all instances
- [ ] Token usage tracked for all runs
- [ ] Cost tracking complete and reconciled
- [ ] Backup of all results created

---

## 5. Statistical Analysis Plan

### 5.1 Primary Analysis

**Null Hypothesis (H₀)**: Supermodel MCP provides no improvement in resolution rate compared to baseline.

**Alternative Hypothesis (H₁)**: Supermodel MCP improves resolution rate compared to baseline.

**Test**: Chi-square test of independence (or Fisher's exact test if cell counts < 5)

**Significance Level**: α = 0.05 (two-tailed)

**Decision Rule**: Reject H₀ if p < 0.05

### 5.2 Secondary Analyses

1. **Token Efficiency**: Mann-Whitney U test comparing token usage per resolved instance
2. **Time Efficiency**: Mann-Whitney U test comparing execution time
3. **First-Attempt Success**: Chi-square test comparing first-attempt resolution rates
4. **Subgroup Analysis**: Compare performance across:
   - Repository types (Django, Flask, scikit-learn, etc.)
   - Issue complexity levels
   - Task types (bug fix, feature, refactor)

### 5.3 Effect Size Reporting

- Cohen's h for resolution rate difference
- Cliff's delta for continuous metrics
- Number needed to treat (NNT) interpretation

### 5.4 Multiple Comparison Correction

Apply Bonferroni correction for subgroup analyses:
- Adjusted α = 0.05 / number of comparisons

### 5.5 Sensitivity Analysis

- Bootstrap confidence intervals (1000 iterations)
- Leave-one-out analysis for influential instances
- Robustness checks with different success criteria

---

## 6. Qualitative Analysis

### 6.1 Manual Code Review

**Sample Size**: 30 resolved instances (15 baseline, 15 supermodel)

**Evaluation Criteria**:
- **Correctness**: Does patch actually fix the issue?
- **Minimality**: Are changes minimal and focused?
- **Code Quality**: Does patch follow repository conventions?
- **Safety**: No introduction of new bugs or vulnerabilities?

**Blinding**: Reviewers evaluate patches without knowing condition

**Inter-Rater Reliability**: Two independent reviewers per patch (Cohen's κ)

### 6.2 Tool Usage Analysis

For Supermodel condition:
- How often was `analyze_codebase` called?
- At what point in conversation was it used?
- What type of graphs were most useful?
- Did codebase analysis lead to better first attempts?

### 6.3 Failure Analysis

Categorize failures:
- Wrong file identified
- Correct file but wrong fix
- Syntax errors in patch
- Test failures (false negatives)
- Timeout/resource exhaustion
- Agent refused/gave up

**Goal**: Identify systematic differences in failure modes

---

## 7. Reproducibility Measures

### 7.1 Containerization

```dockerfile
# docker/Dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Install Node dependencies for MCP
RUN npm install -g @supermodeltools/mcp-server

# Copy evaluation code
COPY src/ /app/src/
COPY scripts/ /app/scripts/
COPY config/ /app/config/

WORKDIR /app

ENTRYPOINT ["python", "-m", "src.harness.executor"]
```

### 7.2 Dependency Pinning

```txt
# requirements.txt
anthropic==0.39.0
docker==7.0.0
numpy==1.26.4
scipy==1.12.0
pandas==2.2.0
matplotlib==3.8.2
seaborn==0.13.1
jupyter==1.0.0
pyyaml==6.0.1
pytest==8.0.0
```

```json
// package.json
{
  "dependencies": {
    "@supermodeltools/mcp-server": "1.0.0"
  }
}
```

### 7.3 Random Seed Management

```python
# All randomness must be seeded
import random
import numpy as np

RANDOM_SEED = 42

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)
```

### 7.4 Complete Artifact Preservation

**Preserve**:
- Exact dataset version and split
- All configuration files
- Complete execution logs
- Full conversation traces
- Generated patches
- Test outputs
- Raw metric files
- Analysis scripts
- Environment specifications

**Version Control**:
- Git commit hash for evaluation code
- Dataset version/commit
- Model version (claude-sonnet-4-5-20250929)
- MCP server version

---

## 8. Resource Planning

### 8.1 Computational Resources

**Options**:

**Option A: Cloud Spot Instances** (Recommended)
- AWS c5.4xlarge spot instance (16 vCPU, 32GB RAM)
- Estimated time: 8-12 hours total
- Estimated cost: $2-5 compute
- Pros: Cost-effective, scalable
- Cons: May be interrupted (use checkpointing)

**Option B: GitHub Actions**
- Matrix parallelization (10-20 jobs)
- Free for public repos
- Pros: Built-in CI/CD, artifact storage
- Cons: 6-hour timeout per job, limited parallelism

**Option C: Dedicated Server**
- 16+ core machine
- 32GB+ RAM
- Fast network connection
- Pros: Full control, no interruptions
- Cons: Higher cost, requires maintenance

### 8.2 Cost Estimation

**Anthropic API Costs** (Claude Sonnet 4.5):
- Input: $3 per million tokens
- Output: $15 per million tokens
- Cache reads: $0.30 per million tokens

**Estimated Token Usage per Instance**:
- Baseline: ~50,000 tokens avg (30k input, 20k output)
- Supermodel: ~60,000 tokens avg (40k input, 20k output)
  - Includes codebase analysis overhead

**Total Estimated API Cost**:
- Baseline: 300 × 50,000 tokens = 15M tokens ≈ $300-500
- Supermodel: 300 × 60,000 tokens = 18M tokens ≈ $400-600
- **Total: $700-1,100 for full evaluation**

**Supermodel API Costs**:
- Codebase analysis: ~$0.10-0.50 per repository
- Caching reduces repeated analysis
- Estimated: $50-100 for evaluation

**Total Budget**: $800-1,200 (plus compute)

### 8.3 Timeline

**Week 1: Setup**
- Repository creation and configuration
- Docker environment setup
- Dataset download and preprocessing
- Agent implementation and testing

**Week 2: Pilot Study**
- Run 30-instance pilot
- Analyze results and refine
- Cost validation
- Protocol refinement

**Week 3: Main Evaluation**
- Day 1-3: Baseline evaluation (300 instances)
- Day 4: Validation and cleanup
- Day 5-7: Supermodel evaluation (300 instances)

**Week 4: Analysis**
- Statistical analysis
- Qualitative review
- Report generation
- Figure creation

**Week 5: Writing**
- Draft paper
- Results review
- Peer feedback
- Revision

**Total: 5 weeks** (can be compressed if needed)

---

## 9. Threats to Validity

### 9.1 Internal Validity

**Threat**: Different token limits between conditions
**Mitigation**: Use identical max_tokens for both

**Threat**: Learning effects (agents improve over time)
**Mitigation**: Randomize instance order within stratification

**Threat**: Environment inconsistencies
**Mitigation**: Fresh Docker container per instance

**Threat**: Non-deterministic model behavior
**Mitigation**: Temperature = 0.0, fixed seed where possible

### 9.2 External Validity

**Threat**: SWE-Bench-Lite not representative of all SE tasks
**Mitigation**: Report limitations, focus on specific task types

**Threat**: Results specific to Claude Sonnet 4.5
**Mitigation**: Acknowledge, suggest future work with other models

**Threat**: Supermodel benefits may vary by codebase characteristics
**Mitigation**: Subgroup analysis by repository type

### 9.3 Construct Validity

**Threat**: Resolution rate doesn't capture solution quality
**Mitigation**: Include qualitative manual review

**Threat**: Test suite may have false positives/negatives
**Mitigation**: Use SWE-Bench's validated test patches

### 9.4 Conclusion Validity

**Threat**: Insufficient sample size for subgroup analyses
**Mitigation**: Focus on primary analysis, treat subgroups as exploratory

**Threat**: Multiple comparisons increase Type I error rate
**Mitigation**: Apply Bonferroni correction

---

## 10. Publication Checklist

### 10.1 Preregistration

- [ ] Register study design on OSF or arXiv before running experiments
- [ ] Document hypothesis, methods, and analysis plan
- [ ] Timestamp preregistration

### 10.2 Data Availability

- [ ] Public repository with all code
- [ ] Processed results (anonymized if needed)
- [ ] Analysis scripts and notebooks
- [ ] Raw conversation logs (may be large, consider hosting)
- [ ] Clear instructions for reproduction

### 10.3 Paper Sections

**Abstract**:
- Research question, method, primary result, significance

**Introduction**:
- Motivation for codebase analysis tools
- SWE-Bench as evaluation benchmark
- Research question and contributions

**Related Work**:
- AI coding assistants
- Program analysis for SE
- SWE-Bench prior results

**Method**:
- Experimental design
- Agent implementations
- Dataset and sampling
- Metrics and analysis plan

**Results**:
- Primary analysis (resolution rates)
- Secondary analyses (efficiency, tool usage)
- Qualitative findings
- Cost analysis

**Discussion**:
- Interpretation of results
- Practical implications
- When Supermodel helps most
- Limitations

**Threats to Validity**:
- Internal, external, construct, conclusion validity

**Conclusion**:
- Summary of findings
- Impact on field
- Future work

### 10.4 Supplementary Materials

- Complete evaluation protocol
- Full statistical analysis code
- Extended results tables
- Example successful and failed patches
- Tool usage traces

---

## 11. Getting Started

### 11.1 Quick Start Commands

```bash
# Clone and setup
git clone https://github.com/yourusername/supermodel-swebench-eval.git
cd supermodel-swebench-eval

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt
npm install

# Setup environment variables
export ANTHROPIC_API_KEY="your-key"
export SUPERMODEL_API_KEY="your-key"

# Download dataset
python scripts/02_download_dataset.sh

# Run pilot study
python scripts/04_run_baseline.py --pilot --instances 15
python scripts/05_run_supermodel.py --pilot --instances 15

# Analyze pilot results
python scripts/06_analyze_results.py --pilot

# Run full evaluation (after pilot validation)
python scripts/04_run_baseline.py --full
python scripts/05_run_supermodel.py --full

# Generate final report
python scripts/07_generate_report.py
```

### 11.2 Testing Your Setup

```bash
# Run unit tests
pytest tests/

# Test single instance end-to-end
python scripts/test_single_instance.py \
  --instance "django__django-12345" \
  --agent baseline

# Verify reproducibility
python scripts/test_single_instance.py \
  --instance "django__django-12345" \
  --agent baseline \
  --runs 3 \
  --check-determinism
```

---

## 12. Success Criteria

**Minimum Viable Success**:
- ✅ Statistically significant improvement in resolution rate (p < 0.05)
- ✅ Effect size is meaningful (Cohen's h > 0.2)
- ✅ Results are reproducible
- ✅ All data and code publicly available

**Ideal Success**:
- ✅ 5+ percentage point improvement in resolution rate
- ✅ Improved efficiency (fewer tokens per resolution)
- ✅ Clear qualitative benefits (better solution quality)
- ✅ Identifiable patterns (when Supermodel helps most)
- ✅ Publishable in top-tier venue (ICSE, FSE, ASE)

---

## 13. Contact and Collaboration

**Evaluation Lead**: [Your name and contact]

**Stakeholders**:
- Supermodel team
- SWE-Bench maintainers (for validation)
- Academic collaborators (if any)

**Communication Channels**:
- GitHub Issues for technical problems
- Discord/Slack for quick questions
- Email for formal correspondence
- Weekly sync meetings during evaluation

---

## Appendix A: Example Configuration Files

```yaml
# config/experiment_config.yaml
experiment:
  name: "supermodel-swebench-lite-eval"
  version: "1.0.0"
  date: "2025-01-06"
  random_seed: 42

dataset:
  name: "swe-bench-lite"
  version: "1.0.0"
  size: 300
  source: "princeton-nlp/SWE-bench"

agents:
  baseline:
    model: "claude-sonnet-4-5-20250929"
    temperature: 0.0
    max_tokens: 100000
    timeout_minutes: 30
    max_turns: 50

  supermodel:
    model: "claude-sonnet-4-5-20250929"
    temperature: 0.0
    max_tokens: 100000
    timeout_minutes: 30
    max_turns: 50
    mcp_enabled: true
    mcp_server: "@supermodeltools/mcp-server"

execution:
  parallel_workers: 8
  checkpoint_frequency: 10
  retry_on_failure: true
  max_retries: 3

logging:
  level: "INFO"
  save_traces: true
  save_conversations: true
  save_patches: true

costs:
  anthropic_input_price: 0.000003  # $3 per 1M tokens
  anthropic_output_price: 0.000015  # $15 per 1M tokens
  supermodel_analysis_price: 0.30  # $0.30 per analysis
  budget_limit: 1500  # $1500 total budget
```

---

## Appendix B: Key References

1. **SWE-Bench**: Jimenez et al. (2024). "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?"

2. **Tool Use**: Schick et al. (2024). "Toolformer: Language Models Can Teach Themselves to Use Tools"

3. **Program Analysis**: Ernst et al. (2007). "The Daikon system for dynamic detection of likely invariants"

4. **Evaluation Methodology**: Wohlin et al. (2012). "Experimentation in Software Engineering"

5. **Statistical Methods**: Cohen (1988). "Statistical Power Analysis for the Behavioral Sciences"

---

## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-01-06 | Initial plan | [Your name] |

---

**This plan is a living document. Update it as the evaluation progresses and new insights emerge.**
