const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAdminApi } = require('../middleware/auth');

// Lấy danh sách nhật ký quản trị (Audit Logs)
router.get('/audit-logs', requireAdminApi, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
        const offset = (page - 1) * limit;
        const search = req.query.search ? `%${req.query.search.trim().toLowerCase()}%` : null;
        const action = req.query.action || 'all';

        let whereConditions = ["1=1"];
        let params = [];
        let paramIdx = 1;

        if (search) {
            whereConditions.push(`(LOWER(username) LIKE $${paramIdx} OR LOWER(action) LIKE $${paramIdx} OR LOWER(entity_type) LIKE $${paramIdx} OR LOWER(entity_id) LIKE $${paramIdx})`);
            params.push(search);
            paramIdx++;
        }

        if (action && action !== 'all') {
            whereConditions.push(`action = $${paramIdx}`);
            params.push(action);
            paramIdx++;
        }

        const whereSql = whereConditions.join(" AND ");

        const countRes = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${whereSql}`, params);
        const total = parseInt(countRes.rows[0].total, 10);

        params.push(limit, offset);
        const listSql = `
            SELECT *
            FROM audit_logs
            WHERE ${whereSql}
            ORDER BY created_at DESC, id DESC
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `;

        const listRes = await pool.query(listSql, params);

        res.json({
            success: true,
            data: listRes.rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Audit logs error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
