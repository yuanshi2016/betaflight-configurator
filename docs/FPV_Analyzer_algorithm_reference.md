# FPV_Analyzer 算法参考文档

本文档是为“跨会话参考”准备的单文件版本，只保留 `FPV_Analyzer.exe` 的算法层内容，不讨论 GUI、工程结构、重写方案或复刻步骤。

目标：

- 说明这套软件到底在计算什么
- 说明它基于哪些数据列和哪些统计量得出结论
- 详细描述时域 PID 分析和频域 FFT 滤波分析
- 尽量避免误导，明确区分“已确认”和“高置信推断”

主要证据来自：

- [FPV_Analyzer.exe](/C:/Users/yuanshi/Desktop/pid/tol/FPV_Analyzer.exe)
- [FPV_Analyzer_extracted](/C:/Users/yuanshi/Desktop/pid/tol/FPV_Analyzer_extracted)
- [main.dis.txt](/C:/Users/yuanshi/Desktop/pid/tol/FPV_Analyzer_extracted/s/main.dis.txt)

## 1. 使用说明

引用本文档时，请遵守这个约定：

- `已确认`：可以当作事实引用
- `高置信推断`：可以用于分析和讨论，但不要说成“源码已逐行证实”

这很重要，因为该程序使用接近 Python 3.14 的字节码，当前只能拿到高质量的结构化逆向结果，还没有 100% 完整源码。

## 2. 总体算法结论

`已确认`

这套软件不是机器学习模型，不是自动 PID 优化器，也不是黑盒“智能调参”。

它本质上是两套规则分析器：

1. `PID 跟随分析（时域）`
2. `噪音滤波分析（频域 FFT）`

其中：

- 时域分析：比较 `Setpoint` 与 `Gyro` 的差异，判断 P/I/D/FF 的调参方向
- 频域分析：对 `Gyro` 和 `D-Term` 信号做 FFT，判断主共振和高频噪音，从而给出滤波建议

最终输出不是一个“计算出的 PID 数值”，而是一组基于经验阈值的建议文本。

## 3. 输入数据与列名识别

### 3.1 支持的原始字段

`已确认`

程序会在 CSV 列名中按小写字符串匹配这些字段：

- `time`
- `gyroadc[axis]`
- `axisrate[axis]` 或 `setpoint[axis]`
- `axisd[axis]` 或 `pidd[axis]`

这里 `axis` 对应：

- `0 = Roll`
- `1 = Pitch`
- `2 = Yaw`

也就是说它面向的是类似 Blackbox 导出 CSV 的列名风格，例如：

- `time`
- `gyroADC[0]`
- `axisRate[0]`
- `axisD[0]`

### 3.2 轴映射

`已确认`

界面中的轴与索引关系是固定的：

- `横滚 (Roll)` -> `0`
- `俯仰 (Pitch)` -> `1`
- `偏航 (Yaw)` -> `2`

### 3.3 列名识别伪代码

`高置信推断`

列名识别逻辑可近似写成：

```python
def find_time_col(columns):
    return next(col for col in columns if "time" in col.lower())

def find_gyro_col(columns, axis_idx):
    return next(
        col for col in columns
        if "gyroadc[" in col.lower() and f"{axis_idx}]" in col.lower()
    )

def find_setpoint_col(columns, axis_idx):
    return next(
        col for col in columns
        if (
            ("axisrate[" in col.lower() and f"{axis_idx}]" in col.lower())
            or
            ("setpoint[" in col.lower() and f"{axis_idx}]" in col.lower())
        )
    )

def find_dterm_col(columns, axis_idx):
    return next(
        col for col in columns
        if (
            ("axisd[" in col.lower() and f"{axis_idx}]" in col.lower())
            or
            ("pidd[" in col.lower() and f"{axis_idx}]" in col.lower())
        )
    )
```

### 3.4 数据清洗

`已确认`

在分析前，程序至少做了这些清洗：

- 列名去空白
- 列名去引号 `"`
- 关键列转数值：`to_numeric(errors='coerce')`
- 删除关键列中无法转成数值的行：`dropna`

`高置信推断`

它还会预扫描 CSV 头部，计算 `skiprows`，跳过 Blackbox 导出文件里非表格数据的前置说明行。

## 4. 时域 PID 跟随分析

### 4.1 目标

`已确认`

时域模式名称就是：

- `PID 跟随分析 (时域)`

图中比较的是：

- `Setpoint (摇杆目标)`
- `Gyro (飞机实际响应)`

因此时域算法的目标不是看电机输出，也不是看 RC 平滑，而是：

- 评估控制目标与真实角速度响应之间的跟随质量

### 4.2 使用的数据

`已确认`

时域模式至少依赖：

- 时间列
- Setpoint 列
- Gyro 列

缺少其中关键列时，程序会直接报：

- `未找到 ... 对应的数据列`
- `无法分析 ...，缺少数据列。`

### 4.3 原始信号

`已确认`

时域分析内部存在这些变量：

- `s_data_full`
- `g_data_full`
- `time_data_full`

对应含义非常清楚：

- `s_data_full`：当前轴的 Setpoint 全量数据
- `g_data_full`：当前轴的 Gyro 全量数据
- `time_data_full`：当前文件的时间戳全量数据

### 4.4 时域核心误差

`高置信推断`

时域分析的核心误差几乎可以确定是：

```python
error_full = s_data_full - g_data_full
```

理由：

- 同时存在 `error_full`
- 只有 Setpoint 和 Gyro 是 PID 模式的主比较对象
- 所有建议文案都围绕“跟随滞后”“超调”“漂移”

### 4.5 核心统计量

`已确认`

程序明确维护了这些统计量变量：

- `rms_error`
- `max_error`
- `mean_err_moving`
- `mean_err_steady`

`高置信推断`

它们的数学定义应当接近：

```python
rms_error = sqrt(mean(error_full ** 2))
max_error = max(abs(error_full))
```

以及：

```python
mean_err_moving = mean(abs(error_moving_full))
mean_err_steady = mean(abs(error_steady_full))
```

### 4.6 运动段 / 静止段划分

`已确认`

程序存在这些变量：

- `s_diff_full`
- `is_moving_full`
- `error_moving_full`
- `error_steady_full`

这已经足以确认：它会根据 Setpoint 的变化，把数据分成“运动段”和“静止段”。

`高置信推断`

较合理的算法是：

```python
s_diff_full = diff(s_data_full)
is_moving_full = abs(s_diff_full) > moving_threshold

error_moving_full = error_full[is_moving_full]
error_steady_full = error_full[~is_moving_full]
```

其中需要注意：

- `moving_threshold` 的精确值目前没有完整恢复
- 但“用 Setpoint 变化量划分运动段”这件事本身非常明确

### 4.7 时域评估使用全量数据

`已确认`

报告中明确写着：

- `评估使用 100% 完整原始数据`

这意味着：

- 即便绘图可能做了降采样
- 真正用于 `RMS`、`Max error`、动态/静态误差判断的数据仍然是全量数据

这个设计很重要，因为它说明：

- 结论不是从简化图形点数直接算出来的

### 4.8 时域指标的实际含义

#### `rms_error`

`高置信推断`

表示整个日志段里，Setpoint 与 Gyro 的整体偏差强度。

特征：

- 对所有时间段都敏感
- 适合做总体健康度概览
- 在报告中用于展示“整体误差水平”

#### `max_error`

`高置信推断`

表示瞬时最大误差。

它更偏向捕捉：

- 急停后的回弹
- 瞬时超调
- 强烈振荡或失真段

因此更适合作为 D 项判断的核心指标之一。

#### `mean_err_moving`

`高置信推断`

表示在“摇杆正在变化”的时间段里，平均跟随误差有多大。

这更贴近：

- P 是否偏低
- FF 是否偏低

因为这两项主要影响动态响应。

#### `mean_err_steady`

`高置信推断`

表示在“摇杆基本不动”的时间段里，平均误差有多大。

这更贴近：

- I 是否不足
- 悬停/巡航的静态锁定能力

### 4.9 P 的建议逻辑

`已确认`

程序内部明确存在：

- `p_thres_high`
- `p_thres_mid`
- `p_adj_high`
- `p_adj_mid`

并且存在这三类文案：

- `Proportional (比例 P) : 建议增加 ...`
- `Proportional (比例 P) : 建议微调 ...`
- `Proportional (比例 P) : 当前控制力健康`

`高置信推断`

可还原为一种三段式规则：

```python
if mean_err_moving > p_thres_high:
    P = "建议增加 p_adj_high"
elif mean_err_moving > p_thres_mid:
    P = "建议微调 p_adj_mid"
else:
    P = "当前控制力健康"
```

它要表达的是：

- 动态跟随误差太大：P 明显偏低
- 动态误差中等：P 略低
- 动态误差小：P 正常

### 4.10 I 的建议逻辑

`已确认`

程序内部存在：

- `i_adj`

并且文案只分成两类：

- `Integral (积分 I) : 建议增加 ...`
- `Integral (积分 I) : 静态锁定健康`

`高置信推断`

这意味着 I 项逻辑更简单，近似为二分：

```python
if mean_err_steady > i_threshold:
    I = "建议增加 i_adj"
else:
    I = "静态锁定健康"
```

这里没有看到明确的 `i_thres_xxx` 变量名，但从：

- `mean_err_steady`
- `i_adj`
- `静态悬停/巡航时存在漂移现象`

可以高置信判断它的核心依据就是静态误差。

### 4.11 D 的建议逻辑

`已确认`

程序内部存在：

- `d_thres_high`
- `d_thres_mid`
- `d_adj_high`
- `d_adj_mid`

并且文案有三类：

- `Derivative (微分 D) : 建议增加 ...`
- `Derivative (微分 D) : 建议微调 ...`
- `Derivative (微分 D) : 阻尼状态健康`

`高置信推断`

可还原成：

```python
if max_error > d_thres_high:
    D = "建议增加 d_adj_high"
elif max_error > d_thres_mid:
    D = "建议微调 d_adj_mid"
else:
    D = "阻尼状态健康"
```

这里的工程含义是：

- 如果急停/反向过程中出现明显大超调，说明阻尼不够
- 如果只是轻微回弹，则做小幅 D 微调

### 4.12 FF 的建议逻辑

`已确认`

FF 文案不是统一的，而是强烈依赖机型：

- 巨型载机：建议关闭或极低 FF
- 中型航拍：建议降低 FF
- 微型/牙签：建议明显增加 FF
- 标准花飞：建议增加或微调 FF

`高置信推断`

FF 的决策机制更像是：

1. 先根据机型决定一个“安全/风格基线”
2. 再结合动态跟随表现决定是“增加”“微调”还是“健康”

它不是纯数学最优化，而是带有很强经验风格偏好的规则项。

### 4.13 时域报告输出项

`已确认`

时域报告里至少包含：

- 当前轴名
- `RMS 整体误差`
- `Max 瞬时震荡误差`
- P 建议
- I 建议
- D 建议
- FF 建议

## 5. 机型分档规则

### 5.1 机型分类

`已确认`

程序有四档机型：

- `1-4寸`
- `5-6寸`
- `7-10寸`
- `11-22寸`

### 5.2 机型上下文

`已确认`

程序存在 `drone_context` 变量，并配套文案：

- 微型/牙签：响应快，可激进
- 标准花飞：综合基准
- 中型航拍：追求平稳，建议保守
- 巨型载机：惯性大，切忌大幅加 P/D

### 5.3 机型影响哪些算法参数

`高置信推断`

机型分支应当决定：

- `p_thres_high`
- `p_thres_mid`
- `d_thres_high`
- `d_thres_mid`
- `p_adj_high`
- `p_adj_mid`
- `i_adj`
- `d_adj_high`
- `d_adj_mid`
- FF 文案和建议幅度

也就是说：

- 同样的误差水平，对不同机型不会给出同样的结论

### 5.4 当前能看到的机型相关数值

`已确认`

在代码常量中能看到如下与机型相关的数字和建议区间：

- `350`
- `400`
- `500`
- `300`
- `+1 到 +2`
- `+2 到 +4`
- `+2 到 +5`
- `+3 到 +6`
- `+2 到 +3`
- `+4 到 +8`
- `+3 到 +5`
- `+5 到 +10`
- `+6 到 +10`
- `+10 到 +20`
- `+5 到 +10`
- `+15 到 +25`

`重要说明`

这些数字确实存在于算法常量表中，但当前不能 100% 严格证明它们分别绑定的是哪一个内部阈值变量。因此：

- 可以说“软件内部按机型使用不同阈值和建议幅度”
- 不能说“源码已证实某机型的某个精确高阈值就是多少”

## 6. 频域 FFT 滤波分析

### 6.1 目标

`已确认`

频域模式的目的不是单纯画频谱，而是输出两类滤波建议：

1. `Gyro 主共振过滤`
2. `D-Term 过滤`

### 6.2 使用的数据

`已确认`

频域模式至少使用：

- 时间列
- Gyro 列

如果能找到 D-Term 列，则还会额外分析：

- `axisd[axis]` 或 `pidd[axis]`

找不到 D-Term 列时，会输出：

- `未在日志中找到 D-Term 数据列，无法独立分析 D-Term 噪音。`

### 6.3 频域内部变量

`已确认`

频域分析里出现了这些变量：

- `dt_us`
- `fs`
- `data_centered`
- `window`
- `fft_vals`
- `fft_freq`
- `fft_mag`
- `d_data_full`
- `d_centered`
- `d_fft_vals`
- `d_fft_mag`
- `high_freq_idx`
- `high_noise_avg`
- `valid_idx`
- `peak_idx`
- `peak_freq`
- `peak_mag`
- `gyro_advice`
- `dterm_advice`

这已经足够清楚地暴露出 FFT 的处理流程。

### 6.4 采样率计算

`高置信推断`

采样率几乎可以确定是这样算的：

```python
dt_us = median(diff(time_data_full))
fs = 1_000_000.0 / dt_us
```

理由：

- 变量名就是 `dt_us`
- 常量里出现 `1000000.0`
- 频域中常见做法就是用时间差倒数估算采样率

这说明：

- 时间单位被当作微秒
- 采样率估计使用中位数步长，而不是均值

### 6.5 去均值和加窗

`已确认`

频域计算前至少做了：

- 去均值：`data_centered`、`d_centered`
- Hann 窗：`hanning`

### 6.6 FFT 计算

`已确认`

代码中明确使用：

- `np.fft.rfft`
- `np.fft.rfftfreq`

`高置信推断`

Gyro 频谱大致是：

```python
data_centered = g_data_full - mean(g_data_full)
window = np.hanning(len(data_centered))
fft_vals = np.fft.rfft(data_centered * window)
fft_freq = np.fft.rfftfreq(len(data_centered), d=1.0 / fs)
fft_mag = abs(fft_vals)
```

D-Term 频谱则是同样一套流程：

```python
d_centered = d_data_full - mean(d_data_full)
d_fft_vals = np.fft.rfft(d_centered * window)
d_fft_mag = abs(d_fft_vals)
```

### 6.7 Gyro 主峰检测

`已确认`

程序中有：

- `valid_idx`
- `peak_idx`
- `peak_freq`
- `peak_mag`

并且有对应提示：

- `机架共振: 在 XX Hz 处有异常尖峰`
- `建议开启一个 Gyro Notch`
- `频率设为 XX Hz，截止频率设为 XX Hz`

`高置信推断`

这说明 Gyro 分析的核心逻辑是：

1. 在某个有效频率区间内筛出可分析部分
2. 在该区间中找主峰
3. 根据主峰频率和幅度判断是否构成异常共振
4. 如果异常，则输出陷波频率建议

大致可写为：

```python
valid_idx = frequency_mask(fft_freq)
peak_idx = argmax(fft_mag[valid_idx])
peak_freq = fft_freq[valid_idx][peak_idx]
peak_mag = fft_mag[valid_idx][peak_idx]

if peak_mag is too high or too sharp:
    gyro_advice = f"Gyro Notch: {peak_freq} Hz ..."
else:
    gyro_advice = "共振健康"
```

### 6.8 D-Term 高频噪音检测

`已确认`

程序明确关注：

- `>150Hz`

并给出文案：

- `D-Term 极度放大了 >150Hz 的高频噪音`
- `建议将 D-Term Lowpass 1 的截止频率降低，例如降至 80-75Hz`

`高置信推断`

这部分内部应当做了：

```python
high_freq_idx = fft_freq > 150
high_noise_avg = mean(d_fft_mag[high_freq_idx])

if high_noise_avg > some_threshold:
    dterm_advice = "下调 D-Term Lowpass 1"
else:
    dterm_advice = "D-Term 滤波良好"
```

它的本质是：

- 并不逐点分析全部高频形状
- 而是对高频段做能量/平均强度的规则判断

### 6.9 频域建议的工程意义

#### Gyro 建议

`高置信推断`

Gyro 分析的目标是找：

- 机架主共振
- 明显尖峰

如果找到破坏性主峰，就建议：

- 开启 Gyro Notch
- Notch 频率对准主峰
- 截止频率相应设置

#### D-Term 建议

`高置信推断`

D-Term 分析的目标是找：

- 微分链路是否把高频噪音过度放大

如果 D-Term 在高频段能量太大，就建议：

- 下调 D-Term Lowpass 1

也就是说：

- Gyro 分析偏向处理“机架共振”
- D-Term 分析偏向处理“电机发热/高频噪音放大”

### 6.10 数据不足保护

`已确认`

频域分析存在明确保护分支：

- `数据不足，无法计算有效 FFT 频谱。`

说明：

- 不是任何短日志都能得到频域结论
- 程序会拒绝对无效或过短数据给出 FFT 诊断

## 7. 这套算法到底输出什么

### 7.1 它输出的不是 PID 数值

`已确认`

它不会直接算出：

- `P = xx`
- `I = xx`
- `D = xx`
- `FF = xx`

它输出的是方向性建议，例如：

- `P 建议增加`
- `P 建议微调`
- `D 建议增加`
- `FF 建议降低`

### 7.2 它输出的是经验规则结论

`已确认`

这套软件本质上是：

- 从日志中提取一组统计量
- 用阈值做规则判断
- 按机型套用不同经验上下文
- 输出文字建议

不是连续优化器，不是自动搜索器，也不是控制理论参数辨识器。

## 8. 最稳妥的总算法表述

如果你在其他会话里只想给出一段尽量准确、不夸张的总结，可以直接引用下面这段：

> `FPV_Analyzer` 会从日志 CSV 中识别 `time`、`gyroadc[axis]`、`axisrate/setpoint[axis]`、`axisd/pidd[axis]` 列。时域模式以 `Setpoint - Gyro` 为核心误差，计算整体 RMS 误差、最大瞬时误差、运动段平均误差、静止段平均误差，并据此按机型规则判断 P/I/D/FF 的调整方向。频域模式使用时间戳估算采样率，对 Gyro 和 D-Term 信号做去均值、Hann 窗和 `rFFT`，从 Gyro 主峰推断机架共振并给出 Gyro Notch 建议，从 D-Term 在 `>150Hz` 高频段的能量强弱推断是否需要下调 `D-Term Lowpass 1`。整套系统是经验规则驱动的日志分析器，而不是自动求解 PID 参数的优化器。`

## 9. 当前不能过度声称的点

以下内容目前不要说成“源码已完全证实”：

- 运动段判定的精确阈值
- P/I/D 各分档阈值的精确数值
- 各机型阈值表的逐项对应关系
- D-Term 高频告警的精确数值门限
- Gyro 主峰“异常尖峰”的精确数学定义
- Gyro Notch 截止频率的精确计算公式

更安全的说法应当是：

- “当前逆向结果显示它存在这些阈值和规则”
- “精确数值映射仍待完整源码或更强反编译器进一步确认”

