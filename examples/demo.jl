# Julia works too: hover a sum, and for/in shows as ∈.

total(x, n) = sum(x[i] for i in 1:n)

dot(a, b, n) = sum(a[i] * b[i] for i = 1:n)

odd_squares(n) = sum(k^2 for k in 1:2:n)

within(v, lo, hi) = lo <= v <= hi && v != Inf

double = x -> 2x

# Matrix literals: spaces between columns, ; or a new line between rows
A = [1 2; 3 4]

R = [cos(θ) -sin(θ)
     sin(θ)  cos(θ)]

v = [1; 2; 3]

normal_eq = inv(A' * A) * A' * y

area = quadgk(x -> exp(-x^2), 0, Inf)[1]
