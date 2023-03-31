
export default class Account {
    constructor(
		public username:string,
		public passwordHash?:string,
		public tracks?: string[],
	) {}
}