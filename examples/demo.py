import math

# Hover over any sum(...) to see it typeset. Lines without the cursor show
# <= >= != -> lambda and friends as symbols; click a line to see the real code.


def total(x, n):
    return sum(x[i] for i in range(1, n+1))


def mean_and_variance(x, n):
    mu = sum(x[i] for i in range(n)) / n
    var = sum((x[i] - mu)**2 for i in range(n)) / n
    return mu, math.sqrt(var)


def basel(N):
    return sum(1/k**2 for k in range(1, N+1))   # -> pi**2 / 6


def dot(a, b, n):
    return sum(a[i]*b[i] for i in range(n))


def matrix_total(A, n, m):
    return sum(A[i][j] for i in range(n) for j in range(m))


def even_terms(x, n):
    return sum(x[i] for i in range(n) if i % 2 == 0)


def geometric(alpha, n):
    return sum(alpha**k for k in range(n))


def product(x, n):
    return math.prod(x[i] for i in range(1, n+1))


def softmax_denominator(z, n):
    return sum(math.exp(z[i]) for i in range(n))


def clamp(v, lo, hi):
    if v <= lo:
        return lo
    if v >= hi:
        return hi
    return v


def is_odd(k) -> bool:
    return k % 2 != 0


square = lambda t: t * t
nearly_zero = lambda eps: abs(eps) <= 1e-9 and eps != float('inf')
