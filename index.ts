import { makeAutoObservable } from "mobx";
import { EasyConnect } from "phantasma-sdk-ts";
import { createContext } from "react";

export interface IConnectWallet {
	address: string,
}

const STORAGE_KEY = "pha-connect-react"

export type LinkTransportMode = "auto" | "injected" | "local-socket"
type LinkTransport = Exclude<LinkTransportMode, "auto">
type FailureClass = "transport" | "wallet"

type PersistConfig = {
	platform: string,
	transportMode: LinkTransport,
}

type ConnectOptions = {
	requiredVersion?: number,
	platform?: string,
	transportMode?: LinkTransportMode,
	transportDetectionTimeoutMs?: number,
	connectAttemptTimeoutMs?: number,
}

type ConnectAttemptDiagnostics = {
	configured_transport_mode: LinkTransportMode,
	requested_transport_mode: LinkTransportMode,
	available_transports: LinkTransport[],
	attempted_transports: LinkTransport[],
	selected_transport: LinkTransport | null,
	fallback_used: boolean,
	fallback_from: LinkTransport | null,
	fallback_to: LinkTransport | null,
	selection_reason: string,
	failure_class: FailureClass | null,
	failure_message: string | null,
	platform: string,
	required_version: number,
	injected_transport_detected: boolean,
	local_socket_reachable: boolean | null,
	socket_transport: string | null,
	socket_open: boolean,
}

type ConnectOverride = {
	platform?: string,
	transportMode?: LinkTransportMode,
}

type TransportDetection = {
	injected_transport_detected: boolean,
	local_socket_reachable: boolean | null,
	available_transports: LinkTransport[],
}

type ConnectAttemptOutcome =
	| {
			success: true,
			conn: EasyConnect,
	  }
	| {
			success: false,
			conn: EasyConnect,
			message: string,
			failureClass: FailureClass,
	  }

type ConnectAttemptResult =
	| {
			success: true,
			conn: EasyConnect,
			socketTransport: string | null,
			socketOpen: boolean,
	  }
	| {
			success: false,
			conn: EasyConnect,
			message: string,
			failureClass: FailureClass,
			socketTransport: string | null,
			socketOpen: boolean,
	  }

export type ConnectCtx = {
	restore: () => void | Promise<void>,
	connect: () => void | Promise<void>,
	disconnect: () => void | Promise<void>,
	is_connecting?: boolean,
	is_disconnecting?: boolean,
	wallet?: IConnectWallet;
}

export function pha_econn_to_conn_wallet(conn: EasyConnect): IConnectWallet {
	return {
		address: conn.link.account.address,
	}
}

function formatConnectError(res: unknown): string | null {
	if (typeof res === "string" && res.length > 0) {
		return res
	}

	if (res instanceof Error && res.message.length > 0) {
		return res.message
	}

	try {
		const serialized = JSON.stringify(res)
		return typeof serialized === "string" && serialized.length > 0 ? serialized : null
	} catch {
		const fallback = String(res)
		return fallback.length > 0 && fallback !== "undefined" ? fallback : null
	}
}

export class PhaConnectState {
	conn: EasyConnect | null = null;
	err_msg: string | null = null;
	is_connecting: boolean = false;
	connect_options: ConnectOptions;
	selected_transport_mode: LinkTransportMode;
	available_transports: LinkTransport[] = [];
	last_connect_diagnostics: ConnectAttemptDiagnostics | null = null;

	constructor(connectOptions: ConnectOptions = {}) {
		this.connect_options = connectOptions
		this.selected_transport_mode = this.normalize_transport_mode(connectOptions.transportMode)
		makeAutoObservable(this);
	}

	private normalize_transport_mode(transportMode: string | null | undefined): LinkTransportMode {
		switch (transportMode) {
			case "auto":
			case "injected":
			case "local-socket":
				return transportMode
			default:
				return "auto"
		}
	}

	private to_concrete_transport(transportMode: string | null | undefined): LinkTransport | null {
		switch (transportMode) {
			case "injected":
			case "local-socket":
				return transportMode
			default:
				return null
		}
	}

	private get transport_detection_timeout_ms(): number {
		return this.connect_options.transportDetectionTimeoutMs ?? 350
	}

	private get connect_attempt_timeout_ms(): number {
		return this.connect_options.connectAttemptTimeoutMs ?? 15000
	}

	private to_sdk_provider_hint(transport: LinkTransport): "ecto" | "poltergeist" {
		return transport === "injected" ? "ecto" : "poltergeist"
	}

	private classify_failure(message: string | null | undefined): FailureClass {
		const normalized = (message ?? "").trim().toLowerCase()
		if (normalized.length === 0) {
			return "transport"
		}

		const transportIndicators = [
			"connection",
			"websocket",
			"socket",
			"timed out",
			"failed to send request",
			"transport",
		]

		return transportIndicators.some((indicator) => normalized.includes(indicator))
			? "transport"
			: "wallet"
	}

	private is_connect_refusal(message: string | null | undefined): boolean {
		const normalized = (message ?? "").trim().toLowerCase()
		if (normalized.length === 0) {
			return false
		}

		const refusalIndicators = [
			"authorization failed",
			"user rejected",
			"transaction cancelled by user",
			"cancelled by user",
			"refused",
			"declined",
		]

		return refusalIndicators.some((indicator) => normalized.includes(indicator))
	}

	private async probe_local_socket(timeoutMs: number = this.transport_detection_timeout_ms): Promise<boolean> {
		if (typeof window === "undefined" || typeof WebSocket === "undefined") {
			return false
		}

		return await new Promise<boolean>((resolve) => {
			let settled = false
			let socket: WebSocket | null = null

			const finalize = (reachable: boolean) => {
				if (settled) {
					return
				}
				settled = true
				clearTimeout(timer)
				if (socket && socket.readyState === WebSocket.OPEN) {
					socket.close()
				}
				resolve(reachable)
			}

			const timer = window.setTimeout(() => finalize(false), timeoutMs)

			try {
				socket = new WebSocket("ws://localhost:7090/phantasma")
				socket.onopen = () => finalize(true)
				socket.onerror = () => finalize(false)
				socket.onclose = () => finalize(false)
			} catch {
				finalize(false)
			}
		})
	}

	private async detect_available_transports(
		requestedTransportMode: LinkTransportMode = this.selected_transport_mode,
	): Promise<TransportDetection> {
		const injected_transport_detected =
			typeof window !== "undefined" && "PhantasmaLinkSocket" in window
		// Explicit modes must not poke the other transport endpoint just to populate
		// diagnostics. In particular, `I` must not touch the localhost PGL socket.
		const local_socket_reachable =
			requestedTransportMode === "auto" || requestedTransportMode === "local-socket"
				? await this.probe_local_socket()
				: null
		const available_transports: LinkTransport[] = []

		if (injected_transport_detected) {
			available_transports.push("injected")
		}

		if (local_socket_reachable) {
			available_transports.push("local-socket")
		}

		this.available_transports = available_transports
		return {
			injected_transport_detected,
			local_socket_reachable,
			available_transports,
		}
	}

	async refresh_available_transports(transportMode: LinkTransportMode = this.selected_transport_mode) {
		return await this.detect_available_transports(transportMode)
	}

	private read_session_config(): PersistConfig | null {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (raw == null) {
			return null
		}

		try {
			const parsed = JSON.parse(raw) as Partial<PersistConfig>
			const transportMode = this.to_concrete_transport(parsed.transportMode)
			if (transportMode == null) {
				return null
			}

			return {
				platform: parsed.platform ?? "phantasma",
				transportMode,
			}
		} catch {
			return null
		}
	}

	private write_session_config(config: PersistConfig) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
	}

	private build_auto_transport_queue(
		availableTransports: LinkTransport[],
		savedTransport: LinkTransport | null,
	): { queue: LinkTransport[], selectionReason: string } {
		if (savedTransport == null || !availableTransports.includes(savedTransport)) {
			return {
				queue: [...availableTransports],
				selectionReason: "auto-prefer-injected-then-local-socket",
			}
		}

		return {
			queue: [
				savedTransport,
				...availableTransports.filter((transport) => transport !== savedTransport),
			],
			selectionReason: "auto-prefer-saved-transport-then-fallback",
		}
	}

	private resolve_persist_config(conn: EasyConnect): PersistConfig {
		return {
			platform: conn.platform,
			transportMode: conn.link.socketTransport === "injected" ? "injected" : "local-socket",
		}
	}

	persist_config() {
		if (this.conn == null) {
			return
		}

		this.write_session_config(this.resolve_persist_config(this.conn))
	}

	restore_from_persist_storage() {
		if (this.conn != null || this.is_connecting) {
			return
		}

		// Session restore is an auto-only convenience. Explicit transport modes must wait
		// for the next user-initiated connect attempt and must not silently reconnect.
		if (this.selected_transport_mode !== "auto") {
			void this.refresh_available_transports(this.selected_transport_mode)
			return
		}

		const config = this.read_session_config()
		if (config == null) {
			void this.refresh_available_transports("auto")
			return
		}

		void this.connect({
			platform: config.platform,
			transportMode: "auto",
		})
	}

	clear_session_storage() {
		localStorage.removeItem(STORAGE_KEY)
	}

	get is_connected(): boolean {
		return this.conn != null
	}

	restore() {
		this.restore_from_persist_storage()
	}

	private async connect_via_transport(
		transport: LinkTransport,
		options: { platform: string, requiredVersion: number },
	): Promise<ConnectAttemptResult> {
		return await new Promise<ConnectAttemptResult>((resolve) => {
			const conn = new EasyConnect([
				String(options.requiredVersion),
				options.platform,
				this.to_sdk_provider_hint(transport),
			])
			let settled = false

			const finalize = (result: ConnectAttemptOutcome) => {
				if (settled) {
					return
				}
				settled = true
				clearTimeout(timer)
				resolve({
					...result,
					socketTransport: conn.link.socketTransport ?? null,
					socketOpen: conn.link.socketOpen,
				})
			}

			const timer = setTimeout(() => {
				const transportEstablished = conn.link.socketOpen
				finalize({
					success: false,
					conn,
					message: transportEstablished
						? `${transport} transport timed out after connection was established`
						: `${transport} transport connection timed out`,
					failureClass: "transport",
				})
			}, this.connect_attempt_timeout_ms)

			conn.connect(
				() => {
					if (!conn.connected) {
						const message = "Wallet connection callback completed without an active session"
						finalize({
							success: false,
							conn,
							message,
							failureClass: this.classify_failure(message),
						})
						return
					}

					finalize({
						success: true,
						conn,
					})
				},
				(res: any) => {
					const message =
						formatConnectError(res) ??
						(conn.link.socketOpen
							? "Wallet connection failed"
							: `${transport} transport failed during connection`)

					finalize({
						success: false,
						conn,
						message,
						failureClass: this.classify_failure(message),
					})
				},
			)
		})
	}

	async connect(configOverride: ConnectOverride = {}) {
		const configuredTransportMode = this.normalize_transport_mode(this.connect_options.transportMode)
		const requestedTransportMode = this.normalize_transport_mode(
			configOverride.transportMode ?? this.selected_transport_mode ?? configuredTransportMode,
		)
		const platform = this.connect_options.platform ?? configOverride.platform ?? "phantasma"
		const requiredVersion = this.connect_options.requiredVersion ?? 4

		this.selected_transport_mode = requestedTransportMode
		this.err_msg = null
		this.conn = null
		this.is_connecting = true

		const detected = await this.detect_available_transports(requestedTransportMode)
		const savedConfig = requestedTransportMode === "auto" ? this.read_session_config() : null
		const autoTransportSelection = this.build_auto_transport_queue(
			detected.available_transports,
			savedConfig?.transportMode ?? null,
		)
		const diagnostics: ConnectAttemptDiagnostics = {
			configured_transport_mode: configuredTransportMode,
			requested_transport_mode: requestedTransportMode,
			available_transports: detected.available_transports,
			attempted_transports: [],
			selected_transport: null,
			fallback_used: false,
			fallback_from: null,
			fallback_to: null,
			selection_reason: requestedTransportMode === "auto"
				? autoTransportSelection.selectionReason
				: "explicit-transport-mode",
			failure_class: null,
			failure_message: null,
			platform,
			required_version: requiredVersion,
			injected_transport_detected: detected.injected_transport_detected,
			local_socket_reachable: detected.local_socket_reachable,
			socket_transport: null,
			socket_open: false,
		}

		let transportQueue: LinkTransport[] = []
		if (requestedTransportMode === "auto") {
			transportQueue = autoTransportSelection.queue
			// The quick localhost probe is advisory only. Preserve the historical
			// websocket path by still attempting the real local-socket connect when
			// auto mode cannot positively detect any transport up front.
			if (transportQueue.length === 0) {
				transportQueue = ["local-socket"]
				diagnostics.selection_reason = "auto-force-local-socket-after-empty-detection"
			}
		} else {
			const requestedTransport = this.to_concrete_transport(requestedTransportMode)
			if (requestedTransport != null) {
				if (detected.available_transports.includes(requestedTransport)) {
					transportQueue = [requestedTransport]
				} else if (requestedTransport === "local-socket") {
					// Explicit local-socket mode must try the real wallet websocket even if
					// the preflight probe could not confirm localhost availability.
					transportQueue = ["local-socket"]
					diagnostics.selection_reason = "explicit-local-socket-forced"
				}
			}
		}

		this.last_connect_diagnostics = diagnostics

		if (transportQueue.length === 0) {
			const message =
				requestedTransportMode === "auto"
					? "No supported wallet transports detected. Enable an injected wallet transport or start a local wallet socket."
					: `Requested ${requestedTransportMode} transport is not available.`
			this.err_msg = message
			this.is_connecting = false
			this.clear_session_storage()
			this.last_connect_diagnostics = {
				...diagnostics,
				failure_class: "transport",
				failure_message: message,
				selection_reason: requestedTransportMode === "auto"
					? "no-transport-detected"
					: "explicit-transport-unavailable",
			}
			return
		}

		for (let index = 0; index < transportQueue.length; index++) {
			const transport = transportQueue[index]
			const previousTransport = index > 0 ? transportQueue[index - 1] : null
			const currentDiagnostics: ConnectAttemptDiagnostics = {
				...diagnostics,
				attempted_transports: [...diagnostics.attempted_transports, transport],
				selected_transport: transport,
				fallback_used: index > 0,
				fallback_from: index > 0 ? previousTransport : null,
				fallback_to: index > 0 ? transport : null,
			}
			this.last_connect_diagnostics = currentDiagnostics

			const attempt = await this.connect_via_transport(transport, {
				platform,
				requiredVersion,
			})

			diagnostics.attempted_transports = currentDiagnostics.attempted_transports
			diagnostics.selected_transport = transport
			diagnostics.fallback_used = currentDiagnostics.fallback_used
			diagnostics.fallback_from = currentDiagnostics.fallback_from
			diagnostics.fallback_to = currentDiagnostics.fallback_to
			diagnostics.socket_transport = attempt.socketTransport
			diagnostics.socket_open = attempt.socketOpen

			if (attempt.success) {
				this.conn = attempt.conn
				this.is_connecting = false
				this.last_connect_diagnostics = {
					...diagnostics,
					failure_class: null,
					failure_message: null,
				}
				this.persist_config()
				return
			}

			diagnostics.failure_class = attempt.failureClass
			diagnostics.failure_message = attempt.message
			this.last_connect_diagnostics = { ...diagnostics }

			const shouldFallback =
				requestedTransportMode === "auto" &&
				(
					attempt.failureClass === "transport" ||
					this.is_connect_refusal(attempt.message)
				) &&
				index < transportQueue.length - 1

			if (shouldFallback) {
				continue
			}

			this.err_msg = attempt.message
			this.is_connecting = false
			this.clear_session_storage()
			return
		}

		this.err_msg = diagnostics.failure_message ?? "Wallet connection failed"
		this.is_connecting = false
		this.clear_session_storage()
	}

	connect_with_transport_mode(transportMode: LinkTransportMode) {
		this.selected_transport_mode = this.normalize_transport_mode(transportMode)
		return this.connect({ transportMode: this.selected_transport_mode })
	}

	set_transport_mode(transportMode: LinkTransportMode) {
		this.selected_transport_mode = this.normalize_transport_mode(transportMode)
	}

	disconnect() {
		if (this.conn == null) {
			return
		}
		this.conn.disconnect()
		this.conn = null
		this.err_msg = null
		this.is_connecting = false
		this.clear_session_storage()
	}
}

export const PhaConnectCtx = createContext<PhaConnectState>(new PhaConnectState())

export { PhaAccountWidgetV1, AccountWidgetV1 } from "./components/AccountWidgetV1"
