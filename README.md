# 🎪 Hệ thống Quản lý Sự kiện – Đề tài 26

Ứng dụng quản lý sự kiện Full-Stack sử dụng **Node.js/Express, PostgreSQL, Nginx và Docker Compose**. Hệ thống triển khai **12 container**, tích hợp giám sát bằng **Prometheus, Grafana, Node Exporter, Nginx Exporter, Postgres Exporter, cAdvisor** và thu thập log bằng **Loki, Promtail**.

## 📐 Kiến trúc hệ thống (12 container)

| Nhóm | Dịch vụ | Image | Cổng trên máy chủ | Chức năng |
|---|---|---|---|---|
| Web | `nginx` | `nginx:alpine` | `80`, `443` | Reverse Proxy; chuyển HTTP sang HTTPS; Security Headers |
| Web | `webapp` | `node:18-alpine` | Nội bộ `3000` | Ứng dụng sự kiện, trang khách hàng và quản trị |
| Database | `postgres` | `postgres:15` | Nội bộ `5432` | Cơ sở dữ liệu, lưu trong volume `pgdata` |
| Database | `pgadmin` | `dpage/pgadmin4` | `5050` | Quản trị PostgreSQL |
| Monitoring | `prometheus` | `prom/prometheus:latest` | `9090` | Thu thập metrics mỗi 15 giây |
| Monitoring | `grafana` | `grafana/grafana:latest` | `3000` | Hiển thị dashboard metrics và logs |
| Monitoring | `node-exporter` | `prom/node-exporter:latest` | Nội bộ `9100` | CPU, RAM, network của Ubuntu |
| Monitoring | `nginx-exporter` | `nginx/nginx-prometheus-exporter:1.4.2` | Nội bộ `9113` | Metrics Nginx |
| Monitoring | `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.16.0` | Nội bộ `9187` | Metrics PostgreSQL |
| Monitoring | `cadvisor` | `ghcr.io/google/cadvisor:v0.60.5` | Nội bộ `8080` | CPU/RAM của từng Docker container |
| Logs | `loki` | `grafana/loki:2.9.0` | `3100` | Lưu và truy vấn log tập trung |
| Logs | `promtail` | `grafana/promtail:2.9.0` | Không publish | Thu thập log và gửi tới Loki |

> **Lưu ý:** Các cổng `3000`, `5050`, `9090`, `3100` đang được publish trên máy chủ theo cấu hình kiểm thử; không nên mở trực tiếp các trang quản trị và giám sát ra Internet. PostgreSQL `5432` và các exporter chỉ dùng mạng Docker nội bộ.

## 📁 Cấu trúc chính

```text
Event_Management_System/
├── app/                       # Ứng dụng Node.js/Express và giao diện
├── nginx/
│   ├── nginx.conf             # HTTP→HTTPS, reverse proxy, stub_status
│   └── ssl/                   # Chứng chỉ HTTPS (không đưa khóa riêng lên Git)
├── prometheus/
│   └── prometheus.yml         # 5 scrape jobs
├── loki/loki-config.yaml
├── promtail/promtail-config.yaml
├── .local/                    # Cấu hình riêng tư (không commit)
├── docker-compose.yml
├── .env                       # Biến môi trường riêng tư (không commit)
└── README.md
```

## 🚀 Triển khai và khởi chạy

### 1. Yêu cầu

Ubuntu có cài **Git, Docker Engine và Docker Compose plugin**; máy có đủ bộ nhớ, dung lượng và kết nối mạng để tải image.

```bash
git clone https://github.com/dtc245200378/He-thong-Quan-ly-Su-kien.git
cd He-thong-Quan-ly-Su-kien
```

### 2. Cấu hình bắt buộc trước khi chạy

Tạo file **`.env`** tại thư mục gốc dự án với các biến mà `docker-compose.yml` yêu cầu:

```dotenv
POSTGRES_USER=<ten_tai_khoan_khoi_tao_moi>
POSTGRES_PASSWORD=<mat_khau_manh>
POSTGRES_DB=event_db
PGADMIN_DEFAULT_EMAIL=<email_quan_tri>
PGADMIN_DEFAULT_PASSWORD=<mat_khau_manh>
DATABASE_URL=<chuoi_ket_noi_postgresql_noi_bo>
JWT_SECRET=<khoa_bi_mat_ngau_nhien>
CUSTOMER_JWT_SECRET=<khoa_bi_mat_ngau_nhien_khac>
```

Tạo khóa bí mật bằng `openssl rand -hex 32`; sử dụng hai khóa khác nhau. Thay toàn bộ giá trị trong dấu `<>` bằng giá trị thực. **Không đưa file `.env` hay mật khẩu lên GitHub.** Với volume `pgdata` đã tồn tại, thay `POSTGRES_USER` không tự đổi tài khoản đã được tạo trong database; phải dùng đúng thông tin database hiện hữu.

Tạo file **`.local/postgres-exporter.env`** (sử dụng tài khoản PostgreSQL chỉ có quyền `pg_monitor`):

```dotenv
DATA_SOURCE_URI=postgres:5432/event_db?sslmode=disable
DATA_SOURCE_USER=postgres_exporter
DATA_SOURCE_PASS=<mat_khau_tai_khoan_giam_sat>
```

```bash
mkdir -p .local nginx/ssl
chmod 600 .env .local/postgres-exporter.env
```

Chuẩn bị `nginx/ssl/server.crt` và `nginx/ssl/server.key` trước khi chạy Nginx. Với môi trường lab có thể sử dụng chứng chỉ tự ký; trình duyệt sẽ cảnh báo cho tới khi chứng chỉ được tin cậy. Bảo vệ file `server.key`, không commit lên Git.

> File `.env`, chứng chỉ HTTPS và tài khoản `postgres_exporter` **không có sẵn trong bản clone công khai**. Với PostgreSQL mới, cần tạo tài khoản giám sát và cấp quyền `pg_monitor` bằng tài khoản quản trị trước khi Postgres Exporter hoạt động. Không sử dụng mật khẩu minh họa trong tài liệu làm mật khẩu thật.

### 3. Khởi chạy

```bash
sudo docker compose config --quiet
sudo docker compose up -d
sudo docker compose ps
curl -k -I https://localhost
```

Website phản hồi `HTTP 200` cho biết Nginx đang phục vụ ứng dụng; `curl -k` bỏ qua kiểm tra độ tin cậy của chứng chỉ. **Không chạy `docker compose down -v`** vì có thể xóa volume database.

### 4. Mỗi lần bật lại Ubuntu VMware

```bash
hostname -I
cd ~/Event_Management_System   # Hoặc thư mục thực tế đã clone
sudo systemctl is-active docker
sudo docker compose ps
```

Nếu Docker chưa chạy: `sudo systemctl start docker`. Nếu container chưa chạy, kiểm tra `.env`, cấu hình và khởi động bằng `sudo docker compose up -d`. Không cần chạy lại `up` khi các dịch vụ đều `Up`. Địa chỉ IP VMware có thể thay đổi sau khi khởi động lại; kiểm tra bằng `hostname -I`.

## 🔗 Địa chỉ truy cập trong mạng lab

Thay `192.168.240.129` bằng IP hiện tại của máy ảo.

| Dịch vụ | Đường dẫn |
|---|---|
| Website khách hàng | `https://192.168.240.129/` |
| Trang Admin | `https://192.168.240.129/admin/` |
| pgAdmin | `http://192.168.240.129:5050/` |
| Grafana | `http://192.168.240.129:3000/` |
| Prometheus Targets | `http://192.168.240.129:9090/targets` |
| Loki readiness (API, không phải trang quản trị) | `http://192.168.240.129:3100/ready` |

Trong pgAdmin, kết nối nội bộ thường dùng host `postgres`, port `5432`, database `event_db`. Tên người dùng phụ thuộc database đã khởi tạo; không dùng mặc định một cách máy móc.

## 📊 Giám sát và log

Prometheus cấu hình **5 job**: `prometheus`, `node_exporter`, `nginx`, `postgres`, `cadvisor`. Trong môi trường đã triển khai, cả 5 target đã được kiểm tra ở trạng thái **UP**.

Trên Grafana Explore, chọn **Prometheus** để xem CPU/RAM từng container:

```promql
sum by (name) (rate(container_cpu_usage_seconds_total{job="cadvisor",name=~"event_management_system-.*"}[5m]))
```

```promql
sum by (name) (container_memory_working_set_bytes{job="cadvisor",name=~"event_management_system-.*"}) / 1024 / 1024
```

Chọn **Loki** để thử 3 truy vấn LogQL:

```logql
{job="dockerlogs"}
```

```logql
{job="dockerlogs"} |~ "(?i)(error|exception|failed)"
```

```logql
{job="dockerlogs"} |= "nginx"
```

Truy vấn cuối chỉ tìm **dòng chứa từ “nginx”**, không đảm bảo dòng đó phát sinh từ container Nginx. Kết quả phụ thuộc log hiện có trong khoảng thời gian chọn.

## 🛡️ Bảo mật và giới hạn

- Webapp chạy với tài khoản không phải root (`uid=1000`); PostgreSQL không publish cổng `5432` ra host.
- Nginx sử dụng HTTPS, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff` và endpoint `stub_status` phục vụ exporter nội bộ.
- UFW đang hoạt động, nhưng cổng Docker publish có thể chịu quy tắc NAT riêng; cần kiểm tra giới hạn truy cập đối với pgAdmin, Grafana, Prometheus và Loki.
- Mật khẩu, JWT secrets và khóa TLS phải lưu ngoài Git; tránh đưa thông tin đăng nhập thật vào README.
- Volume `pgdata` giúp duy trì dữ liệu khi tạo lại container nếu không xóa volume, nhưng **không thay thế sao lưu database**.

## 🧾 GitHub và minh chứng

Lịch sử Git có các commit triển khai Web/DB/Nginx, Prometheus/Grafana và Loki/Promtail/Hardening. Pull Request **#3** đã được merge vào `main`, bổ sung Nginx Exporter, Postgres Exporter, cAdvisor và Prometheus 5 target.

**Lưu ý vận hành:** Kết quả `UP` và ảnh dashboard phản ánh lần kiểm tra thực tế; khi bật lại máy ảo hoặc triển khai máy mới, cần kiểm tra trạng thái dịch vụ và metrics một lần nữa.
