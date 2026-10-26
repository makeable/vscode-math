import math
import numpy as np
import sympy as sp
from scipy.integrate import quad
import jax

# Every line below is plain Python. Math View draws it as maths;
# click a line to see the code.

# Big operators
total = sum(x[i] for i in range(1, n + 1))
product = math.prod(1 + r[t] for t in range(T))
positive = all(v > 0 for v in values)
has_root = any(abs(f(z)) < eps for z in grid)
best = max(score(m) for m in models)
winner = max(range(n), key=lambda i: score(models[i]))
covered = set().union(*(N[v] for v in range(k)))
evens = {2 * k for k in range(n) if k % 3 == 0}

# Calculus
area = quad(lambda x: math.exp(-x**2), 0, math.inf)[0]
exact = sp.integrate(sp.sin(x)**2, (x, 0, sp.pi))
slope = sp.diff(f, x)
curvature = sp.diff(f, x, 2)
deriv = sp.limit((f(x + h) - f(x)) / h, h, 0)
basel = sp.Sum(1 / k**2, (k, 1, sp.oo))
df = jax.grad(loss)

# Fractions, roots and powers
root = (-b + math.sqrt(b**2 - 4 * a * c)) / (2 * a)
density = math.exp(-(x - mu)**2 / (2 * sigma**2)) / math.sqrt(2 * math.pi * sigma**2)
p_k = math.comb(n, k) * p**k * (1 - p)**(n - k)

# Linear algebra
x_hat = np.linalg.inv(A.T @ A) @ A.T @ y
length = np.linalg.norm(v)
cos_theta = np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v))
normal = np.cross(e1, e2)
R = np.array([[math.cos(theta), -math.sin(theta)],
              [math.sin(theta), math.cos(theta)]])

# Piecewise
sign = -1 if x < 0 else 0 if x == 0 else 1
relu = np.where(z > 0, z, 0)

# Statistics
z_score = (x - np.mean(xs)) / np.std(xs)
