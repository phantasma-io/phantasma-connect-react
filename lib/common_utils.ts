
export function now_ms(): number {
	return Date.now()
}

export function tms_human(tms: number): String {
	let seconds = tms / 1000;

	let now = now_ms();
	let now_seconds = now / 1000;

	let sec_ago = now_seconds - seconds;

	const seconds_in_year = 31536000; // 60 seconds * 60 minutes * 24 hours * 365 days
	const seconds_in_day = 24 * 60 * 60; // 86400

	const years = Math.floor(sec_ago / seconds_in_year);
	const days = Math.round(Math.floor(sec_ago / seconds_in_day) % 365);
	let hours = Math.round((seconds / 3600) % 24);
	let minutes = Math.round((seconds % 3600) / 60);
	let sec = Math.round(seconds % 60); 1580573342

	if (years > 0) {
		return `${years}y ${days}d ${hours}h ${minutes}m ${sec}s`
	}
	else if (days > 0) {
		return `${days}d ${hours}h ${minutes}m ${sec}s`
	} else if (hours > 0) {
		return `${hours}h ${minutes}m ${sec}s`
	} else if (minutes > 0) {
		return `${minutes}m ${sec}s`
	} else {
		return `${sec}s`
	}
}

export function str_cut(str: string, count_remain = 6): String {
	if (str.length <= (count_remain * 2) + 3) {
		return str
	}
	let left = str.substring(0, 6)
	let right = str.substring(str.length - 6, str.length)
	return `${left}...${right}` 
}

export function clip_copy(
	content: string,
) {
	navigator.clipboard.writeText(content)
}
