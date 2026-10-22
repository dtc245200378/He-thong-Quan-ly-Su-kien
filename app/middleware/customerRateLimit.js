const buckets = new Map();

function createRateLimit(maxRequests, windowMs) {
    return (req, res, next) => {
        // Dùng địa chỉ kết nối trực tiếp, không tin header X-Forwarded-For.
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const key = `${req.baseUrl}:${req.path}:${ip}`;
        const now = Date.now();

        let bucket = buckets.get(key);

        if (!bucket || now >= bucket.resetAt) {
            bucket = {
                count: 0,
                resetAt: now + windowMs
            };
            buckets.set(key, bucket);
        }

        if (bucket.count >= maxRequests) {
            const retryAfter = Math.max(
                1,
                Math.ceil((bucket.resetAt - now) / 1000)
            );

            res.set('Retry-After', String(retryAfter));

            return res.status(429).json({
                success: false,
                error: 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.'
            });
        }

        bucket.count++;
        next();
    };
}

module.exports = {
    loginLimiter: createRateLimit(10, 60 * 1000),
    registerLimiter: createRateLimit(5, 60 * 60 * 1000)
};
