(() => {
	const nativeFetch = window.fetch.bind(window);

	window.fetch = (input, init) => {
		const requestSignal =
			init?.signal ??
			(typeof Request !== "undefined" && input instanceof Request
				? input.signal
				: undefined);
		if (!requestSignal) return nativeFetch(input, init);

		return new Promise((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				requestSignal.removeEventListener("abort", onAbort);
			};
			const finish = (callback, value) => {
				if (settled) return;
				settled = true;
				cleanup();
				callback(value);
			};
			const onAbort = () => {
				finish(
					reject,
					new DOMException("The operation was aborted.", "AbortError")
				);
			};

			if (requestSignal.aborted) {
				onAbort();
				return;
			}

			requestSignal.addEventListener("abort", onAbort, { once: true });
			nativeFetch(input, init).then(
				(response) => finish(resolve, response),
				(error) =>
					finish(
						reject,
						requestSignal.aborted
							? new DOMException("The operation was aborted.", "AbortError")
							: error
					)
			);
		});
	};
})();
