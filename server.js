const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const PORT = process.env.PORT || 3003; // Server port

// Middleware: Enable CORS, parse JSON bodies
app.use(cors());
app.use(express.json());

// Database connection configuration
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'shift_management',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

// Test database connection on server start
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Lỗi kết nối cơ sở dữ liệu:', err);
        console.error('Chi tiết lỗi DB:', err.stack); // Thêm chi tiết lỗi
    } else {
        console.log('Đã kết nối cơ sở dữ liệu thành công');
    }
});

// ====================================================================
// ROUTES API - ĐẶT TRƯỚC TẤT CẢ CÁC ROUTES PHỤC VỤ FILE HTML/STATIC
// ====================================================================

// Employee Authentication API
app.post('/api/auth/login', async (req, res) => {
    try {
        const { employeeId, password } = req.body;
        
        // Simple authentication (in production, use proper password hashing and JWTs)
        const result = await pool.query(
            'SELECT * FROM employees WHERE employee_id = $1 AND password = $2',
            [employeeId, password]
        );
        
        if (result.rows.length > 0) {
            const employee = result.rows[0];
            res.json({
                success: true,
                employee: {
                    id: employee.id,
                    employeeId: employee.employee_id,
                    name: employee.name,
                    role: employee.role
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Thông tin đăng nhập không chính xác' });
        }
    } catch (error) {
        console.error('Lỗi đăng nhập:', error.stack); // Log chi tiết lỗi
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Shift Types API
app.get('/api/shift-types', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM shift_types ORDER BY default_start_time');
        res.json({ success: true, shiftTypes: result.rows });
    } catch (error) {
        console.error('Lỗi khi lấy các loại ca làm:', error.stack); // Log chi tiết lỗi
        res.status(500).json({ success: false, message: 'Lỗi khi lấy các loại ca làm' });
    }
});


// Employee Availability APIs
app.post('/api/employee-availability', async (req, res) => {
    try {
        const { employeeId, availability, notes } = req.body;
        
        const currentWeekStart = getMondayOfCurrentWeek().toISOString().split('T')[0];
        await pool.query('DELETE FROM employee_availability WHERE employee_id = $1 AND available_date >= $2 AND available_date < $2::date + INTERVAL \'7 day\'', [employeeId, currentWeekStart]);
        
        for (const [key, status] of Object.entries(availability)) {
            const [dayOfWeekString, shiftTypeName] = key.split('-'); 
            const availableDate = getDateFromDay(dayOfWeekString); 

            if (status === 'available' || status === 'unavailable') {
                await pool.query(
                    'INSERT INTO employee_availability (employee_id, available_date, shift_type_name, is_available, note) VALUES ($1, $2, $3, $4, $5)',
                    [employeeId, availableDate, shiftTypeName, status === 'available', notes]
                );
            }
        }
        
        res.json({ success: true, message: 'Đã lưu thông tin khả dụng thành công' });
    } catch (error) {
        console.error('Lỗi khi lưu thông tin khả dụng:', error.stack); // Log chi tiết lỗi
        res.status(500).json({ success: false, message: 'Lỗi khi lưu thông tin khả dụng' });
    }
});

app.get('/api/employee-availability/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const currentWeekStart = getMondayOfCurrentWeek().toISOString().split('T')[0];

        const result = await pool.query(
            'SELECT * FROM employee_availability WHERE employee_id = $1 AND available_date >= $2 AND available_date < $2::date + INTERVAL \'7 day\' ORDER BY available_date, shift_type_name',
            [employeeId, currentWeekStart]
        );
        
        res.json({ success: true, availability: result.rows });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin khả dụng:', error.stack); // Log chi tiết lỗi
        res.status(500).json({ success: false, message: 'Lỗi khi lấy thông tin khả dụng' });
    }
});

// API to handle a single availability update (UPSERT)
app.post('/api/employee-availability/upsert', async (req, res) => {
    try {
        const { employeeId, availableDate, shiftTypeName, isAvailable, notes } = req.body;

        // Validate required fields
        if (employeeId === undefined || availableDate === undefined || shiftTypeName === undefined || isAvailable === undefined) {
            return res.status(400).json({ success: false, message: 'Thiếu các trường thông tin bắt buộc.' });
        }

        console.log('Upserting availability:', { employeeId, availableDate, shiftTypeName, isAvailable, notes });

        const query = `
            INSERT INTO employee_availability (employee_id, available_date, shift_type_name, is_available, note) 
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (employee_id, available_date, shift_type_name) 
            DO UPDATE SET 
              is_available = EXCLUDED.is_available,
              note = EXCLUDED.note;
        `;

        const result = await pool.query(query, [employeeId, availableDate, shiftTypeName, isAvailable, notes || null]);
        console.log('Upsert result:', result);

        res.json({ success: true, message: 'Đã cập nhật trạng thái thành công.' });
    } catch (error) {
        console.error('Lỗi khi cập nhật trạng thái khả dụng:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi cập nhật trạng thái.' });
    }
});

// Debug API to check employee_availability table
app.get('/api/debug/employee-availability', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM employee_availability ORDER BY employee_id, available_date, shift_type_name');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu debug:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi lấy dữ liệu debug' });
    }
});

// API to check employee availability for specific employee and week
app.get('/api/debug/employee-availability/:employeeId/:weekStart', async (req, res) => {
    try {
        const { employeeId, weekStart } = req.params;
        const result = await pool.query(
            'SELECT * FROM employee_availability WHERE employee_id = $1 AND available_date >= $2 AND available_date < $2::date + INTERVAL \'7 day\' ORDER BY available_date, shift_type_name',
            [employeeId, weekStart]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu debug:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi lấy dữ liệu debug' });
    }
});


// Shifts APIs
app.get('/api/shifts', async (req, res) => {
    try {
        const { employeeId, weekStart } = req.query;
        
        let query = `
            SELECT 
                s.id, s.shift_type, s.start_time, s.end_time, s.notes, s.break_start_time, s.break_end_time,
                s.start_date::text, 
                s.end_date::text,
                COALESCE(json_agg(json_build_object('id', e.id, 'name', e.name, 'employee_id', e.employee_id)) FILTER (WHERE e.id IS NOT NULL), '[]') AS assigned_employees
            FROM shifts s 
            LEFT JOIN shift_assignments sa ON s.id = sa.shift_id
            LEFT JOIN employees e ON sa.employee_id = e.id
        `;
        let params = [];
        const whereClauses = [];
        
        if (employeeId) {
            params.push(employeeId);
            whereClauses.push(`sa.employee_id = $${params.length}`);
        }

        if (weekStart) {
            params.push(weekStart);
            whereClauses.push(`s.start_date >= $${params.length} AND s.start_date < $${params.length}::date + INTERVAL '7 day'`);
        }
        
        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }
        
        query += ' GROUP BY s.id ORDER BY s.start_date, s.start_time';
        
        const result = await pool.query(query, params);
        res.json({ success: true, shifts: result.rows });
    } catch (error) {
        console.error('Lỗi khi lấy danh sách ca làm việc (SQL Error):', error.stack); // Log chi tiết lỗi SQL
        res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách ca làm việc' });
    }
});

app.post('/api/shifts', async (req, res) => {
    try {
        const { shiftType, startTime, startDate, endTime, endDate, employeeIds, notes, breakStartTime, breakEndTime } = req.body;
        
        const shiftResult = await pool.query(
            'INSERT INTO shifts (shift_type, start_time, start_date, end_time, end_date, notes, break_start_time, break_end_time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
            [shiftType, startTime, startDate, endTime, endDate, notes, breakStartTime, breakEndTime]
        );
        
        const shiftId = shiftResult.rows[0].id;
        
        if (employeeIds && employeeIds.length > 0) {
            for (const employeeId of employeeIds) {
                await pool.query(
                    'INSERT INTO shift_assignments (shift_id, employee_id) VALUES ($1, $2)',
                    [shiftId, employeeId]
                );
            }
        }
        
        res.json({ success: true, message: 'Đã tạo ca làm việc thành công', shiftId });
    } catch (error) {
        console.error('Lỗi khi tạo ca làm việc:', error.stack); // Log chi tiết lỗi
        res.status(500).json({ success: false, message: 'Lỗi khi tạo ca làm việc' });
    }
});

app.put('/api/shifts/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { shiftType, startTime, startDate, endTime, endDate, employeeIds, notes, breakStartTime, breakEndTime } = req.body;

        await client.query('BEGIN');

        // Update shift details
        await client.query(
            'UPDATE shifts SET shift_type = $1, start_time = $2, start_date = $3, end_time = $4, end_date = $5, notes = $6, break_start_time = $7, break_end_time = $8 WHERE id = $9',
            [shiftType, startTime, startDate, endTime, endDate, notes, breakStartTime, breakEndTime, id]
        );

        // Update employee assignments
        // 1. Delete existing assignments for this shift
        await client.query('DELETE FROM shift_assignments WHERE shift_id = $1', [id]);

        // 2. Insert new assignments
        if (employeeIds && employeeIds.length > 0) {
            for (const employeeId of employeeIds) {
                await client.query(
                    'INSERT INTO shift_assignments (shift_id, employee_id) VALUES ($1, $2)',
                    [id, employeeId]
                );
            }
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Đã cập nhật ca làm việc thành công' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Lỗi khi cập nhật ca làm việc:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi cập nhật ca làm việc' });
    } finally {
        client.release();
    }
});

app.delete('/api/shifts/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');

        // Delete assignments first due to foreign key constraint
        await client.query('DELETE FROM shift_assignments WHERE shift_id = $1', [id]);
        
        // Then delete the shift
        const result = await client.query('DELETE FROM shifts WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Không tìm thấy ca làm để xóa' });
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Đã xóa ca làm việc thành công' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Lỗi khi xóa ca làm việc:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa ca làm việc' });
    } finally {
        client.release();
    }
});


// Auto Scheduling API - A basic greedy algorithm for demonstration
app.post('/api/schedule/auto', async (req, res) => {
    try {
        const { weekStart } = req.body; // YYYY-MM-DD format for the start of the week (e.g., Monday)
        const MIN_SHIFTS_PER_EMPLOYEE = 5; // Yêu cầu: Tối thiểu 5 ca/tuần (có thể làm 7 ngày)
        const MAX_HOURS_PER_WEEK = 48; // Giới hạn giờ làm việc trong tuần

        // Clear existing shifts and assignments for the week to reschedule
        await pool.query('DELETE FROM shift_assignments WHERE shift_id IN (SELECT id FROM shifts WHERE start_date >= $1 AND start_date < $1::date + INTERVAL \'7 day\')', [weekStart]);
        await pool.query('DELETE FROM shifts WHERE start_date >= $1 AND start_date < $1::date + INTERVAL \'7 day\'', [weekStart]);
        
        // Get all active employees
        const employeesResult = await pool.query('SELECT * FROM employees WHERE is_active = true ORDER BY id');
        const employees = employeesResult.rows;

        const employeeShiftCounts = new Map();
        const employeeHourCounts = new Map(); // New map to track hours per employee
        employees.forEach(emp => {
            employeeShiftCounts.set(emp.id, 0);
            employeeHourCounts.set(emp.id, 0); // Initialize hours to 0
        });

        const shiftTypesResult = await pool.query('SELECT * FROM shift_types ORDER BY default_start_time');
        const shiftRequirements = shiftTypesResult.rows.map(st => ({
            type: st.type_name,
            startTime: st.default_start_time,
            endTime: st.default_end_time,
            employeesNeeded: st.employees_needed,
            breakStart: st.default_break_start_time,
            breakEnd: st.default_break_end_time
        }));

        const availabilityMap = new Map();
        for (const employee of employees) {
            const availResult = await pool.query(
                `SELECT available_date, shift_type_name, is_available 
                 FROM employee_availability 
                 WHERE employee_id = $1 
                 AND available_date >= $2 AND available_date < $2::date + INTERVAL '7 day'`,
                [employee.id, weekStart]
            );
            const empAvail = new Map();
            availResult.rows.forEach(row => {
                const dateStr = row.available_date.toISOString().split('T')[0];
                if (!empAvail.has(dateStr)) {
                    empAvail.set(dateStr, []);
                }
                empAvail.get(dateStr).push(row);
            });
            availabilityMap.set(employee.id, empAvail);
        }
        
        const scheduledShifts = [];
        
        const daysToSchedule = [1, 2, 3, 4, 5, 6, 7]; // Thứ 2 đến Chủ nhật (7 ngày)
        for (const dayOfWeekNum of daysToSchedule) { 
            const currentDay = new Date(weekStart);
            currentDay.setDate(currentDay.getDate() + (dayOfWeekNum - 1));
            const shiftDate = currentDay.toISOString().split('T')[0]; // YYYY-MM-DD

            for (const requirement of shiftRequirements) {
                // Tìm các nhân viên có thể nhận ca mà không vượt quá 48 tiếng/tuần
                const potentialAssignees = [];
                for (const employee of employees) {
                    const empDailyAvail = availabilityMap.get(employee.id)?.get(shiftDate) || [];
                    const isAvailable = empDailyAvail.some(avail => 
                        avail.is_available && 
                        avail.shift_type_name === requirement.type
                    );
                    if (isAvailable) {
                        // Tính số giờ của ca này
                        let shiftHours = 0;
                        if (requirement.startTime && requirement.endTime) {
                            const [sh, sm] = requirement.startTime.split(":").map(Number);
                            const [eh, em] = requirement.endTime.split(":").map(Number);
                            shiftHours = (eh + em/60) - (sh + sm/60);
                            // Trừ thời gian nghỉ nếu có
                            if (requirement.breakStart && requirement.breakEnd) {
                                const [bsh, bsm] = requirement.breakStart.split(":").map(Number);
                                const [beh, bem] = requirement.breakEnd.split(":").map(Number);
                                shiftHours -= (beh + bem/60) - (bsh + bsm/60);
                            }
                        }
                        // Kiểm tra tổng số giờ sau khi thêm ca này
                        const currentHours = employeeHourCounts.get(employee.id) || 0;
                        if (currentHours + shiftHours <= MAX_HOURS_PER_WEEK) {
                            potentialAssignees.push({ employee, shiftHours });
                        }
                    }
                }
                // Sắp xếp ưu tiên nhân viên chưa đủ 5 ca, sau đó theo số ca đã nhận
                potentialAssignees.sort((a, b) => {
                    const aCount = employeeShiftCounts.get(a.employee.id) || 0;
                    const bCount = employeeShiftCounts.get(b.employee.id) || 0;
                    const aBelowMin = aCount < MIN_SHIFTS_PER_EMPLOYEE;
                    const bBelowMin = bCount < MIN_SHIFTS_PER_EMPLOYEE;
                    if (aBelowMin && !bBelowMin) return -1;
                    if (!aBelowMin && bBelowMin) return 1;
                    return aCount - bCount;
                });
                // Lấy đúng số lượng cần thiết
                const assignedEmployees = potentialAssignees.slice(0, requirement.employeesNeeded);
                if (assignedEmployees.length > 0) {
                    const shiftResult = await pool.query(
                        'INSERT INTO shifts (shift_type, start_time, start_date, end_time, end_date, break_start_time, break_end_time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                        [requirement.type, requirement.startTime, shiftDate, requirement.endTime, shiftDate, requirement.breakStart, requirement.breakEnd]
                    );
                    const shiftId = shiftResult.rows[0].id;
                    for (const { employee, shiftHours } of assignedEmployees) {
                        await pool.query(
                            'INSERT INTO shift_assignments (shift_id, employee_id) VALUES ($1, $2)',
                            [shiftId, employee.id]
                        );
                        employeeShiftCounts.set(employee.id, (employeeShiftCounts.get(employee.id) || 0) + 1);
                        employeeHourCounts.set(employee.id, (employeeHourCounts.get(employee.id) || 0) + shiftHours);
                    }
                    scheduledShifts.push({
                        shiftId,
                        type: requirement.type,
                        date: shiftDate,
                        employees: assignedEmployees.map(a => a.employee.name)
                    });
                }
            }
        }
        
        const employeesNotMeetingMinimum = [];
        employees.forEach(emp => { 
            const count = employeeShiftCounts.get(emp.id) || 0;
            if (count < MIN_SHIFTS_PER_EMPLOYEE) {
                employeesNotMeetingMinimum.push({ name: emp.name, shifts: count });
            }
        });

        let finalMessage = `Đã xếp lịch tự động ${scheduledShifts.length} ca làm việc.`;
        if (employeesNotMeetingMinimum.length > 0) {
            finalMessage += ` Cảnh báo: Một số nhân viên không đạt tối thiểu ${MIN_SHIFTS_PER_EMPLOYEE} ca: ${employeesNotMeetingMinimum.map(e => `${e.name} (${e.shifts})`).join(', ')}`;
        }

        res.json({ 
            success: true, 
            message: finalMessage,
            shifts: scheduledShifts
        });
    } catch (error) {
        console.error('Lỗi khi xếp lịch tự động:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi xếp lịch tự động' });
    }
});

app.post('/api/schedule/clear', async (req, res) => {
    const client = await pool.connect();
    try {
        const { weekStart } = req.body; // YYYY-MM-DD format

        if (!weekStart) {
            return res.status(400).json({ success: false, message: 'Thiếu tham số weekStart' });
        }

        await client.query('BEGIN'); // Bắt đầu transaction

        // Lấy ID của các ca làm trong tuần để đảm bảo xóa đúng assignments
        const shiftsToDeleteResult = await client.query(
            'SELECT id FROM shifts WHERE start_date >= $1 AND start_date < $1::date + INTERVAL \'7 day\'',
            [weekStart]
        );

        const shiftIds = shiftsToDeleteResult.rows.map(row => row.id);

        if (shiftIds.length > 0) {
            // Xóa các phân công ca làm trước (do có khóa ngoại)
            await client.query(
                'DELETE FROM shift_assignments WHERE shift_id = ANY($1::int[])',
                [shiftIds]
            );

            // Sau đó xóa chính các ca làm
            await client.query(
                'DELETE FROM shifts WHERE id = ANY($1::int[])',
                [shiftIds]
            );
        }
        
        await client.query('COMMIT'); // Commit transaction
        
        res.json({ success: true, message: `Đã xóa thành công ${shiftIds.length} ca làm việc trong tuần.` });
    } catch (error) {
        await client.query('ROLLBACK'); // Rollback khi có lỗi
        console.error('Lỗi khi xóa lịch làm việc (transaction rolled back):', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa lịch làm việc' });
    } finally {
        client.release(); // Trả client về pool
    }
});

// Employees API (for Manager UI to get list of employees)
app.get('/api/employees', async (req, res) => {
    try {
        const weekStart = getMondayOfCurrentWeek().toISOString().split('T')[0];

        const query = `
            SELECT 
                e.id, e.name, e.employee_id, e.role,
                COUNT(s.id) FILTER (WHERE s.id IS NOT NULL) AS shift_count,
                COALESCE(SUM(
                    (EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0)
                    - 
                    COALESCE(EXTRACT(EPOCH FROM (s.break_end_time - s.break_start_time)) / 3600.0, 0)
                ), 0) AS total_hours
            FROM 
                employees e
            LEFT JOIN 
                shift_assignments sa ON e.id = sa.employee_id
            LEFT JOIN 
                shifts s ON sa.shift_id = s.id AND s.start_date >= $1 AND s.start_date < $1::date + INTERVAL '7 day'
            WHERE 
                e.is_active = true
            GROUP BY 
                e.id
            ORDER BY 
                e.name;
        `;

        const result = await pool.query(query, [weekStart]);
        res.json({ success: true, employees: result.rows });
    } catch (error) {
        console.error('Lỗi khi lấy danh sách nhân viên:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách nhân viên' });
    }
});

// Salary calculation API
app.get('/api/salary/calculate', async (req, res) => {
    try {
        const { employeeId, weekStart } = req.query;
        
        if (!weekStart) {
            return res.status(400).json({ success: false, message: 'Thiếu tham số weekStart' });
        }

        let query = `
            SELECT 
                s.*,
                e.id as employee_id,
                e.name as employee_name,
                e.employee_id as employee_code
            FROM shifts s 
            INNER JOIN shift_assignments sa ON s.id = sa.shift_id
            INNER JOIN employees e ON sa.employee_id = e.id
            WHERE s.start_date >= $1 AND s.start_date < $1::date + INTERVAL '7 day'
        `;
        let params = [weekStart];

        if (employeeId) {
            query += ' AND e.id = $2';
            params.push(employeeId);
        }

        query += ' ORDER BY e.name, s.start_date, s.start_time';

        const result = await pool.query(query, params);
        
        // Group by employee and calculate salary
        const employeeSalaryData = {};
        
        result.rows.forEach(shift => {
            const empId = shift.employee_id;
            if (!employeeSalaryData[empId]) {
                employeeSalaryData[empId] = {
                    employeeId: empId,
                    employeeName: shift.employee_name,
                    employeeCode: shift.employee_code,
                    totalHours: 0,
                    weekdayHours: 0,
                    weekendHours: 0,
                    weekdaySalary: 0,
                    weekendSalary: 0,
                    totalSalary: 0,
                    shifts: []
                };
            }

            // Calculate shift duration
            const startDateTime = new Date(`${shift.start_date}T${shift.start_time}`);
            const endDateTime = new Date(`${shift.end_date}T${shift.end_time}`);
            let durationHours = (endDateTime - startDateTime) / (1000 * 60 * 60);

            // Subtract break time if exists
            if (shift.break_start_time && shift.break_end_time) {
                const breakStart = new Date(`${shift.start_date}T${shift.break_start_time}`);
                const breakEnd = new Date(`${shift.start_date}T${shift.break_end_time}`);
                const breakHours = (breakEnd - breakStart) / (1000 * 60 * 60);
                durationHours -= breakHours;
            }

            // Determine if it's weekend (Saturday = 6, Sunday = 0)
            const dayOfWeek = startDateTime.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday

            // Add to appropriate category
            if (isWeekend) {
                employeeSalaryData[empId].weekendHours += durationHours;
                employeeSalaryData[empId].weekendSalary += durationHours * 25; // 25/h for weekends
            } else {
                employeeSalaryData[empId].weekdayHours += durationHours;
                employeeSalaryData[empId].weekdaySalary += durationHours * 22; // 22/h for weekdays
            }

            employeeSalaryData[empId].totalHours += durationHours;
            employeeSalaryData[empId].totalSalary = employeeSalaryData[empId].weekdaySalary + employeeSalaryData[empId].weekendSalary;
            
            // Add shift details
            employeeSalaryData[empId].shifts.push({
                id: shift.id,
                shiftType: shift.shift_type,
                startDate: shift.start_date,
                startTime: shift.start_time,
                endTime: shift.end_time,
                durationHours: durationHours,
                isWeekend: isWeekend,
                salary: isWeekend ? durationHours * 25 : durationHours * 22
            });
        });

        const salaryData = Object.values(employeeSalaryData);
        
        // Calculate totals
        const totals = salaryData.reduce((acc, emp) => {
            acc.totalHours += emp.totalHours;
            acc.weekdayHours += emp.weekdayHours;
            acc.weekendHours += emp.weekendHours;
            acc.weekdaySalary += emp.weekdaySalary;
            acc.weekendSalary += emp.weekendSalary;
            acc.totalSalary += emp.totalSalary;
            return acc;
        }, {
            totalHours: 0,
            weekdayHours: 0,
            weekendHours: 0,
            weekdaySalary: 0,
            weekendSalary: 0,
            totalSalary: 0
        });

        res.json({ 
            success: true, 
            salaryData: salaryData,
            totals: totals,
            weekStart: weekStart
        });
    } catch (error) {
        console.error('Lỗi khi tính lương:', error.stack);
        res.status(500).json({ success: false, message: 'Lỗi khi tính lương' });
    }
});

// Helper functions
function getMondayOfCurrentWeek() {
    const today = new Date();
    const dayOfWeek = (today.getDay() === 0) ? 7 : today.getDay(); // 1 for Mon, 7 for Sun
    const diff = today.getDate() - dayOfWeek + 1; // Adjust to Monday
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0); // Reset time to start of day
    return monday;
}

function getDateFromDay(dayString) {
    const monday = getMondayOfCurrentWeek();
    const daysMap = { 'T2': 0, 'T3': 1, 'T4': 2, 'T5': 3, 'T6': 4, 'T7': 5, 'CN': 6 }; 
    const daysToAdd = daysMap[dayString];
    const finalDate = new Date(monday);
    finalDate.setDate(monday.getDate() + daysToAdd);
    return finalDate.toISOString().split('T')[0]; //YYYY-MM-DD
}

function getNextHour(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const nextHour = new Date(); 
    nextHour.setHours(hours + 1, minutes, 0, 0); 
    return nextHour.toTimeString().slice(0, 5); 
}

// Handle favicon requests to avoid 404 errors in browser console
app.get('/favicon.ico', (req, res) => res.status(204).send());

// ====================================================================
// ROUTES PHỤC VỤ FILE HTML - ĐẶT SAU TẤT CẢ CÁC ROUTES API
// ====================================================================

// Route gốc (/) sẽ phục vụ trang đăng nhập
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

// Route cho giao diện quản lý
app.get('/management', (req, res) => {
    res.sendFile(__dirname + '/Management_UI.html');
});

// Serves the Employee Dashboard (after login)
app.get('/employee/dashboard', (req, res) => {
    res.sendFile(__dirname + '/employee.html');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
    console.log(`Trang đăng nhập: http://localhost:${PORT}`);
    console.log(`Giao diện quản lý (yêu cầu đăng nhập): http://localhost:${PORT}/management`);
    console.log(`Giao diện nhân viên (yêu cầu đăng nhập): http://localhost:${PORT}/employee/dashboard`);
});
