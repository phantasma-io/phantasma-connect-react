"use client"
import { useEffect } from "react"
import { Button } from "../components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu"
import { ConnectCtx, pha_econn_to_conn_wallet, PhaConnectState } from "../index"
import { clip_copy, str_cut } from "../lib/common_utils"
import { Wallet } from "lucide-react"
import { observer } from "mobx-react"

export const AccountWidgetV1 = observer((params: {
	ctx: ConnectCtx
}) => {
	let { ctx } = params

	useEffect(() => {
		ctx.restore()
	}, [])

	function Connect() {
		return (
			<div>
				<Button
					variant="outline"
					onClick={() => {
						ctx.connect()
					}}
				>
					{ctx.is_connecting ? 'Connecting...' : 'Connect wallet'}
				</Button>
			</div>
		)
	}

	function Acc() {
		let w = ctx.wallet!;
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline">
						<div>
							<div></div>
							<div>{str_cut(w.address)}</div>
						</div>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem
						onClick={() => {
							clip_copy(w.address)
						}}
					>
						Copy address
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive"
						onClick={() => {
							ctx.disconnect()
						}}
					>
						Disconnect
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu >

		)
	}

	return (
		ctx.wallet ? Acc() : Connect()
	)
})

export const PhaAccountWidgetV1 = observer((params: {
	state: PhaConnectState
}) => {
	let { state } = params
	return (
		<AccountWidgetV1
			ctx={{
				connect: () => {
					state.connect()
				},
				disconnect: () => {
					state.disconnect()
				},
				restore: () => {
					state.restore()
				},
				is_connecting: state.is_connecting,
				wallet: state.conn == null ? undefined : pha_econn_to_conn_wallet(state.conn)
			}}
		/>
	)
})
