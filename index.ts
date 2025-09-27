import { makeAutoObservable } from "mobx";
import { EasyConnect } from "phantasma-sdk-ts";
import { createContext } from "react";


export interface IConnectWallet {
	address: string,
}

const STORAGE_KEY = "pha-connect-react"

type PersistConfig = {
	platform: string,
	providerHint: string,
	// dapp: string,
}

export type ConnectCtx = {
	//======================
	restore: () => void,
	connect: () => void,
	disconnect: () => void,
	//======================
	is_connecting?: boolean,
	is_disconnecting?: boolean,
	//======================
	wallet?: IConnectWallet;
}

export function pha_econn_to_conn_wallet(conn: EasyConnect): IConnectWallet {
	let l = conn.link
	return {
		address: l.account.address,
	}
}

export class PhaConnectState {
	conn: EasyConnect | null = null;
	err_msg: string | null = null;
	is_connecting: boolean = false;

	constructor() {
		makeAutoObservable(this);
	}

	persist_config() {
		if (this.conn == null) {
			return
		}

		let config: PersistConfig = {
			platform: this.conn.platform,
			providerHint: this.conn.providerHint
		}

		localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
	}

	restore_from_persist_storage() {
		if (this.conn != null) {
			return
		}
		if (this.is_connecting) {
			return
		}

		let raw = localStorage.getItem(STORAGE_KEY);
		if (raw == null) {
			return
		}
		let config: PersistConfig = JSON.parse(raw);
		this.connect()
	}

	clean_persist_storage() {
		localStorage.removeItem(STORAGE_KEY)
	}

	get is_connected(): boolean {
		return this.conn != null
	}

	restore() {
		this.restore_from_persist_storage()
	}

	connect() {
		this.err_msg = null;
		this.conn = null;
		this.is_connecting = true;
		let conn = new EasyConnect();
		conn.connect(
			() => {
				this.is_connecting = false;
				if (!conn.connected) {
					return
				}
				this.conn = conn
				console.log(`${JSON.stringify(conn.nexus)}`)
				this.persist_config()
			},
			(res: any) => {
				this.is_connecting = false;
				this.err_msg = JSON.stringify(res)
				this.clean_persist_storage()
			}
		)
	}

	disconnect() {
		if (this.conn == null) {
			return
		}
		this.conn.disconnect()
		this.conn = null;
		this.err_msg = null;
		this.is_connecting = false;
		this.clean_persist_storage()
	}

}

export const PhaConnectCtx = createContext<PhaConnectState>(new PhaConnectState())

export { PhaAccountWidgetV1, AccountWidgetV1 } from "./components/AccountWidgetV1"


