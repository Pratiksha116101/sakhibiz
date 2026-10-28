USE defaultdb;

CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  preferred_language ENUM('mr','en') NOT NULL DEFAULT 'mr',
  village VARCHAR(120) NOT NULL DEFAULT '',
  coach_interests VARCHAR(40) NOT NULL DEFAULT 'food',
  coach_skills VARCHAR(1000) NOT NULL DEFAULT '',
  starting_budget DECIMAL(12,2) NOT NULL DEFAULT 0,
  hours_available TINYINT UNSIGNED NOT NULL DEFAULT 2,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lessons (
  lesson_id INT UNSIGNED NOT NULL PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  mr_title VARCHAR(180) NOT NULL,
  category VARCHAR(80) NOT NULL,
  minutes TINYINT UNSIGNED NOT NULL,
  level VARCHAR(40) NOT NULL DEFAULT 'Beginner',
  body TEXT NOT NULL,
  mr_body TEXT NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lesson_progress (
  progress_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  lesson_id INT UNSIGNED NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_user_lesson (user_id, lesson_id),
  CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_progress_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quiz_questions (
  question_id INT UNSIGNED NOT NULL PRIMARY KEY,
  question_en VARCHAR(500) NOT NULL,
  question_mr VARCHAR(500) NOT NULL,
  options_en JSON NOT NULL,
  options_mr JSON NOT NULL,
  correct_option TINYINT UNSIGNED NOT NULL,
  explanation_en TEXT NOT NULL,
  explanation_mr TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quiz_results (
  attempt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  total_questions TINYINT UNSIGNED NOT NULL,
  answers_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_quiz_user_date (user_id, created_at),
  CONSTRAINT fk_quiz_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS business_plans (
  plan_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  business_name VARCHAR(150) NOT NULL DEFAULT '',
  product VARCHAR(200) NOT NULL DEFAULT '',
  target_customers VARCHAR(1000) NOT NULL DEFAULT '',
  startup_budget DECIMAL(12,2) NOT NULL DEFAULT 0,
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  marketing TEXT NOT NULL,
  first_goal TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_plans_user (user_id, updated_at),
  CONSTRAINT fk_plans_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  product_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  image_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_products_user (user_id, created_at),
  CONSTRAINT fk_products_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_products_plan FOREIGN KEY (plan_id) REFERENCES business_plans(plan_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expenses (
  expense_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NULL,
  product_id BIGINT UNSIGNED NULL,
  label VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'other',
  amount DECIMAL(12,2) NOT NULL,
  expense_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_expenses_user_date (user_id, expense_date),
  CONSTRAINT fk_expenses_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_expenses_plan FOREIGN KEY (plan_id) REFERENCES business_plans(plan_id) ON DELETE SET NULL,
  CONSTRAINT fk_expenses_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS promotions (
  promotion_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  language ENUM('mr','en') NOT NULL DEFAULT 'mr',
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_promotions_user (user_id, created_at),
  CONSTRAINT fk_promotions_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_promotions_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS action_tasks (
  task_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  mr_title VARCHAR(200) NOT NULL DEFAULT '',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  due_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Moderated Sakhi Circle community storage.
CREATE TABLE IF NOT EXISTS community_groups (
  group_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_groups_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_memberships (
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('member','moderator') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id,user_id),
  CONSTRAINT fk_membership_group FOREIGN KEY (group_id) REFERENCES community_groups(group_id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_posts (
  post_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  status ENUM('visible','under_review','removed') NOT NULL DEFAULT 'visible',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_circle_group_feed (group_id,status,created_at),
  KEY idx_circle_user_posts (user_id,created_at),
  CONSTRAINT fk_posts_group FOREIGN KEY (group_id) REFERENCES community_groups(group_id) ON DELETE CASCADE,
  CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_reports (
  report_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT UNSIGNED NOT NULL,
  reporter_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(300) NOT NULL,
  status ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_circle_reports_post (post_id,status,created_at),
  KEY idx_circle_reports_user (reporter_id,status),
  CONSTRAINT fk_reports_post FOREIGN KEY (post_id) REFERENCES community_posts(post_id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_user FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_post_meta (
  post_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  post_type ENUM('story','product','opportunity','workshop','resource') NOT NULL DEFAULT 'story',
  title VARCHAR(160) NOT NULL DEFAULT '',
  link_url VARCHAR(1000) NULL,
  CONSTRAINT fk_post_meta_post FOREIGN KEY (post_id) REFERENCES community_posts(post_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_moderation_log (
  log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NULL,
  report_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NULL,
  notes VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_circle_log_post (post_id,created_at),
  CONSTRAINT fk_circle_log_actor FOREIGN KEY (actor_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_circle_log_post FOREIGN KEY (post_id) REFERENCES community_posts(post_id) ON DELETE SET NULL,
  CONSTRAINT fk_circle_log_report FOREIGN KEY (report_id) REFERENCES community_reports(report_id) ON DELETE SET NULL
) ENGINE=InnoDB;
