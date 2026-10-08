"""校验模型推导；简化状态模型校验不等于完整交互系统验收。"""
import json
import math
import random
from pathlib import Path


def time_factor(z):
    return -math.expm1(-z) / z if z else 1.0


def exact_correct_uptime(hard, silent, repair_rate, horizon):
    """初始运行、指数维修、无检查点/亚健康，静默后奖励为零。"""
    if not silent:
        availability = repair_rate / (hard + repair_rate)
        return availability + (1 - availability) * time_factor((hard + repair_rate) * horizon)
    if not hard:
        return time_factor(silent * horizon)
    total = hard + silent + repair_rate
    delta = math.sqrt(total * total - 4 * repair_rate * silent)
    r_fast = -(total + delta) / 2
    r_slow = -2 * repair_rate * silent / (total + delta)
    a = (-(hard + silent) - r_fast) / (r_slow - r_fast)
    return a * time_factor(-r_slow * horizon) + (1 - a) * time_factor(-r_fast * horizon)


def simulate(hard, silent, repair_rate, horizon, trials=10000, seed=20260922):
    rng = random.Random(seed)
    values = []
    for _ in range(trials):
        clock = reward = 0.0
        while clock < horizon:
            wait = rng.expovariate(hard + silent)
            reward += min(wait, horizon - clock)
            clock += wait
            if clock >= horizon or rng.random() < silent / (hard + silent):
                break
            clock += rng.expovariate(repair_rate)
        values.append(reward / horizon)
    mean = sum(values) / trials
    se = math.sqrt(sum((v - mean) ** 2 for v in values) / (trials - 1) / trials)
    return mean, se


hard_fit = 1e9 / (10000 * 30)
all_fit = hard_fit / .976
assert math.isclose(.976 * .95 + .02 * .95, .9462)
assert math.isclose(.976 + .02 * .95, .995)
assert math.isclose(all_fit * .976, hard_fit)
checks = []
for n in (10000, 100000, 500000):
    hard = n * hard_fit / 1e9
    silent = n * all_fit * .004 / 1e9
    exact = exact_correct_uptime(hard, silent, .5, 720)
    mean, se = simulate(hard, silent, .5, 720)
    assert abs(mean - exact) < 5 * se + 1e-5
    availability = 1 / (1 + hard * 2)
    checks.append({
        "cards": n, "all_event_mtbf_hours": 1e9 / (n * all_fit),
        "continuous_exposure_silent_factor": time_factor(silent * 720),
        "simple_state_exact_correct_uptime": exact,
        "monte_carlo_mean": mean, "monte_carlo_standard_error": se,
        "naive_product_without_exposure_correction": availability * time_factor(silent * 720),
        "mean_exposure_product_approximation": availability * time_factor(silent * availability * 720)
    })

assert exact_correct_uptime(0, 0, .5, 720) == 1
assert math.isclose(exact_correct_uptime(0, .01, .5, 720), time_factor(7.2))
assert math.isclose(exact_correct_uptime(1, 0, .5, 720), 1/3 + (2/3)*time_factor(1080))

# 独立数值积分检查条件回退工作量，包含保存阶段失败。
rollback_checks = []
for rate, tau, save in [(1/30, 2, 10/3600), (1/.6, 2, 10/3600), (1/30, 6/3600, .001/3600)]:
    length = tau + save
    denominator = -math.expm1(-rate * length)
    formula = (-math.expm1(-rate*tau)/rate - tau*math.exp(-rate*length))/denominator
    count = 100000
    dt = length/count
    quadrature = sum(min((i+.5)*dt, tau)*rate*math.exp(-rate*(i+.5)*dt)*dt for i in range(count))/denominator
    assert abs(formula-quadrature) < 1e-8
    rollback_checks.append({"rate_per_hour": rate, "formula_hours": formula, "quadrature_hours": quadrature})

result = {
    "result": "passed", "automatic_detection": .9462, "eventual_detection": .995,
    "scope": "Simplified no-checkpoint/no-slowdown Markov reward model only; repairs exponential with mean 2h after immediate detection; not a full-system prediction.",
    "checks": checks, "rollback_checks": rollback_checks
}
Path(__file__).with_name('三类故障公式复核结果.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
